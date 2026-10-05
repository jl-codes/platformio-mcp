/** Read-only monitor status reconstructs durable context and never trusts a PID alone. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ inspect: vi.fn() }));
vi.mock("../src/core/devices/process-identity.js", async (original) => ({
  ...(await original<
    typeof import("../src/core/devices/process-identity.js")
  >()),
  inspectProcessIdentity: state.inspect,
}));
const priorData = process.env.PIO_MCP_DATA_DIR;
const testRoot = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "pio-status-persistence-")),
);
process.env.PIO_MCP_DATA_DIR = testRoot;
const {
  registerPioMonitorPid,
  getPersistedMonitorStatuses,
  unregisterPioMonitorPid,
} = await import("../src/utils/process-manager.js");
const { getMonitorStatus, getSpoolerStates } =
  await import("../src/tools/monitor.js");
const { platformioExecutor } = await import("../src/platformio.js");
const pid = 12345;
const identity = {
  pid,
  platform: process.platform,
  startToken: "original-monitor",
};
const project = path.join(testRoot, "project-a");
const otherProject = path.join(testRoot, "project-b");
const logFile = path.join(project, "monitor.log");
const registryPath = path.join(
  testRoot,
  "serial_monitors",
  "monitor-pids.json",
);

beforeEach(() => {
  vi.restoreAllMocks();
  state.inspect.mockReturnValue({ status: "running", identity });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(logFile, "fixture log\n");
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  for (const suffix of ["", ".identities.json", ".metadata.json"])
    fs.writeFileSync(registryPath + suffix, "{}");
});
afterAll(() => {
  vi.restoreAllMocks();
  if (priorData === undefined) delete process.env.PIO_MCP_DATA_DIR;
  else process.env.PIO_MCP_DATA_DIR = priorData;
});
process.once("exit", () => {
  try {
    fs.rmSync(testRoot, { recursive: true, force: true });
  } catch {}
});

async function recordMonitor(port = "COM42") {
  await registerPioMonitorPid(
    port,
    pid,
    project,
    undefined,
    logFile,
    "persisted-task",
    undefined,
    {
      baudRate: 57600,
      environment: "fixture",
      startedAt: "2026-10-05T00:00:00.000Z",
    },
  );
}

describe("persisted monitor status", () => {
  it("returns live durable context without watchers, execution, or registry mutation", async () => {
    await recordMonitor();
    const before = ["", ".identities.json", ".metadata.json"].map((suffix) =>
      fs.readFileSync(registryPath + suffix, "utf8"),
    );
    const watch = vi.spyOn(fs, "watch");
    const spawn = vi.spyOn(platformioExecutor, "spawn");
    expect(getMonitorStatus("com42", project)).toMatchObject({
      state: "active",
      port: "COM42",
      projectDir: project,
      logPath: logFile,
      taskId: "persisted-task",
      baudRate: 57600,
      environment: "fixture",
      startedAt: "2026-10-05T00:00:00.000Z",
    });
    expect(getMonitorStatus("COM42", otherProject)).toMatchObject({
      state: "inactive",
    });
    expect(getMonitorStatus(undefined, otherProject)).toEqual({ monitors: [] });
    expect(getMonitorStatus(undefined, project)).toMatchObject({
      monitors: [{ state: "active", port: "COM42" }],
    });
    expect(getSpoolerStates()).toEqual({});
    expect(watch).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(
      ["", ".identities.json", ".metadata.json"].map((suffix) =>
        fs.readFileSync(registryPath + suffix, "utf8"),
      ),
    ).toEqual(before);
  });

  it.each(["absent", "unknown", "reused"])(
    "marks %s process identity stale",
    async (observation) => {
      await recordMonitor();
      state.inspect.mockReturnValue(
        observation === "reused"
          ? {
              status: "running",
              identity: { ...identity, startToken: "replacement-process" },
            }
          : { status: observation },
      );
      expect(getMonitorStatus("COM42", project)).toMatchObject({
        state: "stale",
      });
    },
  );

  it("does not promote numeric legacy tracking or mismatched metadata to active", async () => {
    fs.writeFileSync(registryPath, JSON.stringify({ COM42: pid }));
    expect(getMonitorStatus("COM42")).toMatchObject({ state: "stale" });
    await recordMonitor();
    const metadata = JSON.parse(
      fs.readFileSync(registryPath + ".metadata.json", "utf8"),
    );
    metadata.COM42.identity.startToken = "different-start";
    fs.writeFileSync(registryPath + ".metadata.json", JSON.stringify(metadata));
    expect(getMonitorStatus("COM42")).toMatchObject({ state: "stale" });
    expect(getMonitorStatus("COM42", project)).toMatchObject({
      state: "inactive",
    });
  });

  it("preserves identity-verified pre-upgrade monitor status using matched project history", async () => {
    await recordMonitor();
    fs.unlinkSync(registryPath + ".metadata.json");
    expect(getMonitorStatus("COM42", project)).toMatchObject({
      state: "active",
      taskId: "persisted-task",
      projectDir: project,
      logPath: logFile,
    });
    expect(getMonitorStatus("COM42", otherProject)).toMatchObject({
      state: "inactive",
    });
    state.inspect.mockReturnValue({ status: "unknown" });
    expect(getMonitorStatus("COM42", project)).toMatchObject({
      state: "stale",
    });
  });

  it("shares alias selectors while retaining project ownership", async () => {
    const native = "/dev/ttyUSB37";
    const alias = "/dev/serial/by-id/status-fixture";
    const originalRealpath = fs.realpathSync.native;
    vi.spyOn(fs.realpathSync, "native").mockImplementation((target, options) =>
      [native, alias].includes(String(target))
        ? native
        : originalRealpath(target, options),
    );
    await recordMonitor(alias);
    expect(getMonitorStatus(alias, project)).toMatchObject({
      state: "active",
      port: native,
    });
    expect(getMonitorStatus(native, otherProject)).toMatchObject({
      state: "inactive",
    });
    await unregisterPioMonitorPid(alias, project);
    expect(getPersistedMonitorStatuses()).toEqual([]);
    expect(
      JSON.parse(fs.readFileSync(registryPath + ".metadata.json", "utf8")),
    ).toEqual({});
  });

  it.each(["", ".identities.json", ".metadata.json"])(
    "reports corrupt %s registry rather than false inactivity",
    (suffix) => {
      fs.writeFileSync(registryPath + suffix, "not-json");
      expect(() => getMonitorStatus("COM42")).toThrow(
        expect.objectContaining({ code: "MONITOR_REGISTRY_INVALID" }),
      );
    },
  );

  it("returns inactive only when no selected monitor is recorded", () => {
    expect(getMonitorStatus("COM42", project)).toEqual({
      state: "inactive",
      port: "COM42",
      projectDir: project,
    });
    expect(getMonitorStatus()).toEqual({ monitors: [] });
  });
});
