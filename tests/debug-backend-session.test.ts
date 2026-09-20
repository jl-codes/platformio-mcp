/** Backend/GDB startup shares one probe lease and retains recovery ownership when cleanup is uncertain. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({
  waitStarted: vi.fn(),
  cleanupProcess: vi.fn(),
  state: vi.fn(),
}));
vi.mock("../src/core/debug/debug-backend-process.js", () => ({
  DebugBackendProcess: vi.fn(function () {
    return backend;
  }),
}));
vi.mock("../src/core/debug/debug-backend-readiness.js", () => ({
  validateBackendReadyPattern: vi.fn(async () => {}),
  waitForBackendReady: vi.fn(async () => {}),
}));
import { waitForBackendReady } from "../src/core/debug/debug-backend-readiness.js";
import { DebugBackendProcess } from "../src/core/debug/debug-backend-process.js";
import {
  DebugProcess,
  type DebugProcessOptions,
} from "../src/core/debug/debug-process.js";
import { DebugStartupFailure } from "../src/core/debug/debug-start-failure.js";
import {
  startDebuggerWithBackend,
  preflightDebuggerBackend,
} from "../src/core/debug/debug-backend-session.js";
let root: string;
let closed: boolean;
beforeEach(() => {
  root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "pio-backend-session-")),
  );
  vi.stubEnv("PIO_MCP_POLICY_FILE", path.join(root, "operator.json"));
  vi.stubEnv("PIO_MCP_DATA_DIR", path.join(root, "data"));
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        allow: ["upload_firmware", "run_shell_command"],
        deny: [],
        approval_required: [],
        audit_all_agent_actions: false,
      },
    }),
  );
  vi.clearAllMocks();
  closed = false;
  backend.waitStarted.mockResolvedValue(undefined);
  backend.state.mockImplementation(() => ({
    pid: 12,
    closed,
    cleanupPending: !closed,
    outputTail: "ready",
  }));
  backend.cleanupProcess.mockImplementation(async () => {
    closed = true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
function input() {
  const custody = {
    prepareSpawn: vi.fn(async () => {}),
    releaseAfterExit: vi.fn(),
  };
  const selected: DebugProcessOptions = {
    executable: path.join(root, "gdb"),
    elfPath: path.join(root, "firmware.elf"),
    projectDir: root,
    custody,
    confirmProbeReleased: async () => true,
  };
  return {
    debugger: selected,
    backend: {
      pythonExecutable: path.join(root, "python.exe"),
      command: {
        executable: path.join(root, "openocd.exe"),
        cwd: root,
        arguments: [],
      },
    },
    readyPattern: "ready",
    sessionId: "owned-session",
    timeoutMs: 30000,
  };
}
it("prepares custody once and releases only after backend cleanup following GDB exit", async () => {
  const args = input();
  vi.spyOn(DebugProcess, "start").mockResolvedValue({} as DebugProcess);
  await startDebuggerWithBackend(args);
  expect(args.debugger.custody.prepareSpawn).toHaveBeenCalledOnce();
  expect(waitForBackendReady).toHaveBeenCalledOnce();
  const options = vi.mocked(DebugProcess.start).mock.calls[0][0];
  await options.custody.prepareSpawn();
  expect(args.debugger.custody.prepareSpawn).toHaveBeenCalledOnce();
  expect(() => options.custody.releaseAfterExit()).toThrow();
  expect(args.debugger.custody.releaseAfterExit).not.toHaveBeenCalled();
  expect(await options.confirmProbeReleased!()).toBe(true);
  options.custody.releaseAfterExit();
  options.custody.releaseAfterExit();
  expect(args.debugger.custody.releaseAfterExit).toHaveBeenCalledOnce();
});
it("denies target effect before backend launch even when host execution is permitted", async () => {
  const args = input();
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        allow: ["run_shell_command"],
        deny: ["upload_firmware"],
        approval_required: [],
        audit_all_agent_actions: false,
      },
    }),
  );
  await expect(startDebuggerWithBackend(args)).rejects.toMatchObject({
    code: "POLICY_DENIED",
  });
  expect(DebugBackendProcess).not.toHaveBeenCalled();
  expect(args.debugger.custody.prepareSpawn).not.toHaveBeenCalled();
  expect(args.debugger.custody.releaseAfterExit).toHaveBeenCalledOnce();
});
it("retains a recovery owner when readiness fails and backend cleanup is uncertain", async () => {
  const args = input();
  vi.mocked(waitForBackendReady).mockRejectedValueOnce(new Error("not ready"));
  backend.cleanupProcess.mockRejectedValueOnce(new Error("still running"));
  let failure: unknown;
  try {
    await startDebuggerWithBackend(args);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(DebugStartupFailure);
  expect(args.debugger.custody.releaseAfterExit).not.toHaveBeenCalled();
  const recovery = (failure as DebugStartupFailure).cleanupOwner();
  await expect(recovery.command("bt", {})).rejects.toMatchObject({
    code: "DEBUG_SESSION_RECOVERY_ONLY",
  });
  await recovery.cleanupProcess();
  expect(args.debugger.custody.releaseAfterExit).toHaveBeenCalledOnce();
});
it("cleans backend when GDB fails before returning a process owner", async () => {
  const args = input();
  vi.spyOn(DebugProcess, "start").mockRejectedValueOnce(
    new Error("spawn failed"),
  );
  await expect(startDebuggerWithBackend(args)).rejects.toThrow("spawn failed");
  expect(backend.cleanupProcess).toHaveBeenCalledOnce();
  expect(args.debugger.custody.releaseAfterExit).toHaveBeenCalledOnce();
});

it("keeps backend approval scope identical before and after private ELF retention", async () => {
  const args = { ...input(), elfSha256: "a".repeat(64) };
  const original = await preflightDebuggerBackend(args);
  const retained = await preflightDebuggerBackend({
    ...args,
    debugger: {
      ...args.debugger,
      elfPath: path.join(root, "private-snapshot", "firmware.elf"),
    },
  });
  expect(retained).toEqual(original);
  expect(original.stages[0].args.elfSha256).toBe(args.elfSha256);
  expect(original.stages[0].args.elfPath).toBeUndefined();
  expect(DebugBackendProcess).not.toHaveBeenCalled();
  expect(args.debugger.custody.prepareSpawn).not.toHaveBeenCalled();
});
it("uses proven backend group closure without an extra host callback for supervised GDB", async () => {
  const args = input();
  args.debugger.supervisorPython = args.backend.pythonExecutable;
  delete args.debugger.confirmProbeReleased;
  vi.spyOn(DebugProcess, "start").mockResolvedValue({} as DebugProcess);
  await startDebuggerWithBackend(args);
  const options = vi.mocked(DebugProcess.start).mock.calls[0][0];
  expect(await options.confirmProbeReleased!()).toBe(true);
  expect(closed).toBe(true);
  options.custody.releaseAfterExit();
  expect(args.debugger.custody.releaseAfterExit).toHaveBeenCalledOnce();
});
it("does not turn incomplete backend cleanup into a release proof", async () => {
  const args = input();
  args.debugger.supervisorPython = args.backend.pythonExecutable;
  delete args.debugger.confirmProbeReleased;
  backend.cleanupProcess.mockResolvedValue(undefined);
  vi.spyOn(DebugProcess, "start").mockResolvedValue({} as DebugProcess);
  await startDebuggerWithBackend(args);
  const options = vi.mocked(DebugProcess.start).mock.calls[0][0];
  expect(await options.confirmProbeReleased!()).toBe(false);
  expect(() => options.custody.releaseAfterExit()).toThrow();
  expect(args.debugger.custody.releaseAfterExit).not.toHaveBeenCalled();
});
