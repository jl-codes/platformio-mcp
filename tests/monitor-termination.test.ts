/** Monitor termination requires recorded process identity and confirmed exit; no real processes are signalled. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ root: "", inspect: vi.fn(), kill: vi.fn() }));
vi.mock("../src/utils/paths.js", () => ({
  get SERVER_DATA_DIR() {
    return state.root;
  },
  ensureGlobalDirs: () => {},
}));
vi.mock("../src/core/devices/process-identity.js", async (original) => ({
  ...(await original<
    typeof import("../src/core/devices/process-identity.js")
  >()),
  inspectProcessIdentity: state.inspect,
}));
vi.mock("tree-kill", () => ({ default: state.kill }));
vi.mock("../src/utils/command-registry.js", () => ({
  registerCommand: vi.fn(async () => {}),
  updateTaskStatus: vi.fn(async () => {}),
  getCommandHistory: () => [],
}));
import {
  registerPioMonitorPid,
  killPioMonitorByPort,
  getActiveMonitorPids,
} from "../src/utils/process-manager.js";
const identity = {
  pid: 12345,
  platform: process.platform,
  startToken: "original",
};
beforeEach(() => {
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-monitor-stop-"));
  state.inspect.mockReturnValue({ status: "running", identity });
});
afterEach(() => {
  vi.resetAllMocks();
  fs.rmSync(state.root, { recursive: true, force: true });
});
it("rejects PID reuse without signalling or deleting tracking", async () => {
  await registerPioMonitorPid("COM42", identity.pid);
  state.inspect.mockReturnValue({
    status: "running",
    identity: { ...identity, startToken: "replacement" },
  });
  await expect(killPioMonitorByPort("COM42")).rejects.toMatchObject({
    code: "PROCESS_IDENTITY_UNVERIFIED",
  });
  expect(state.kill).not.toHaveBeenCalled();
  expect(getActiveMonitorPids().COM42).toBe(identity.pid);
});
it("retains tracking on signal failure and removes it only after confirmed exit", async () => {
  await registerPioMonitorPid("COM42", identity.pid);
  state.kill.mockImplementation((_pid, _signal, callback) =>
    callback(new Error("denied")),
  );
  await expect(killPioMonitorByPort("COM42")).rejects.toThrow("denied");
  expect(getActiveMonitorPids().COM42).toBe(identity.pid);
  state.kill.mockImplementation((_pid, _signal, callback) => {
    state.inspect.mockReturnValue({ status: "absent" });
    callback();
  });
  expect(await killPioMonitorByPort("COM42")).toBe(true);
  expect(getActiveMonitorPids().COM42).toBeUndefined();
});
it("does not claim a missing monitor was stopped or kill a legacy unverified PID", async () => {
  expect(await killPioMonitorByPort("COM42")).toBe(false);
  const directory = path.join(state.root, "serial_monitors");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "monitor-pids.json"),
    JSON.stringify({ COM42: identity.pid }),
  );
  await expect(killPioMonitorByPort("COM42")).rejects.toMatchObject({
    code: "PROCESS_IDENTITY_UNVERIFIED",
  });
  expect(state.kill).not.toHaveBeenCalled();
});
