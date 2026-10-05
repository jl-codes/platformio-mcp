/** Legacy monitor launch preserves filters and rejects stale process tracking. */
import { execFileSync } from "node:child_process";
import { PIO_MONITOR_BRIDGE } from "../src/utils/pio-monitor-bridge.js";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";

// Configure isolated claim/registry storage before importing the monitor.
const previousDataDir = process.env.PIO_MCP_DATA_DIR;
const testDataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "pio-monitor-launch-data-"),
);
process.env.PIO_MCP_DATA_DIR = testDataDir;
process.once("exit", () => {
  try {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  } catch {}
});
afterAll(() => {
  if (previousDataDir === undefined) delete process.env.PIO_MCP_DATA_DIR;
  else process.env.PIO_MCP_DATA_DIR = previousDataDir;
});

const state = vi.hoisted(() => ({
  spawn: vi.fn(),
  pids: {} as Record<string, number>,
  records: {} as Record<
    string,
    import("../src/utils/process-manager.js").PersistedMonitorStatus
  >,
  alive: true,
}));
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: { spawn: state.spawn },
}));
vi.mock("../src/tools/devices.js", () => ({
  findDeviceByPort: async () => ({ hwid: "test" }),
}));
vi.mock("../src/utils/process-manager.js", () => ({
  registerPioMonitorPid: async (
    port: string,
    pid: number,
    projectDir?: string,
    _root?: string,
    logFile?: string,
    taskId?: string,
    _command?: string,
    details?: import("../src/utils/process-manager.js").MonitorRegistrationDetails,
  ) => {
    state.pids[port] = pid;
    state.records[port] = {
      port,
      pid,
      state: "active",
      projectDir,
      logFile,
      taskId,
      ...details,
    };
  },
  killPioMonitorByPort: async (port: string) => {
    delete state.pids[port];
    return true;
  },
  getActiveMonitorPids: () => state.pids,
  getPersistedMonitorStatuses: (projectDir?: string) =>
    Object.entries(state.pids)
      .map(([port, pid]) => ({
        ...state.records[port],
        port,
        pid,
        state: state.alive ? "active" : "stale",
      }))
      .filter((record) => !projectDir || record.projectDir === projectDir),
  isPidAlive: () => state.alive,
  isBuildActive: () => false,
}));
vi.mock("../src/core/devices/serial-endpoint.js", async (original) => ({
  ...(await original<
    typeof import("../src/core/devices/serial-endpoint.js")
  >()),
  resolveSerialEndpoint: (port: string) => ({
    requestedPort: port,
    canonicalPort: port,
    resource: { kind: "serial", identity: `fixture:${port}` },
    revalidate: vi.fn(),
  }),
}));
vi.mock("../src/core/devices/device-lease.js", async (original) => {
  const actual =
    await original<typeof import("../src/core/devices/device-lease.js")>();
  return {
    ...actual,
    DeviceLeaseStore: class extends actual.DeviceLeaseStore {
      status(
        resource: import("../src/core/devices/device-lease.js").DeviceResource,
      ) {
        return { status: "unclaimed" as const, resource };
      }
    },
  };
});
const { startMonitor, stopMonitor, getMonitorStatus } =
  await import("../src/tools/monitor.js");
const roots: string[] = [];
afterEach(async () => {
  await stopMonitor("COM42", roots[0]);
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
  vi.clearAllMocks();
  state.pids = {};
  state.records = {};
  state.alive = true;
});

it("does not blend an old in-memory daemon into a replacement persisted monitor", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-monitor-launch-"));
  roots.push(root);
  state.spawn.mockImplementation(async () =>
    Object.assign(new EventEmitter(), { pid: 12345, unref: vi.fn() }),
  );
  await startMonitor("COM42", 115200, root, "old-environment");
  state.pids.COM42 = 54321;
  state.records.COM42 = {
    port: "COM42",
    pid: 54321,
    state: "active",
    projectDir: `${root}-replacement`,
    taskId: "replacement-task",
  };
  const status = getMonitorStatus("COM42");
  expect(status).toMatchObject({
    state: "active",
    taskId: "replacement-task",
    projectDir: `${root}-replacement`,
  });
  expect(status).toMatchObject({
    baudRate: undefined,
    environment: undefined,
    logPath: undefined,
    cursor: undefined,
    lastActivityAt: undefined,
    leaseOwner: undefined,
  });
});
it("retains configured filtering and exposes a dead or missing tracked process as stale", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-monitor-launch-"));
  roots.push(root);
  state.spawn.mockImplementation(async () =>
    Object.assign(new EventEmitter(), { pid: 12345, unref: vi.fn() }),
  );
  await startMonitor("COM42", 115200, root, "fixture");
  const [command, args, options] = state.spawn.mock.calls[0];
  expect(command).toBe("device");
  expect(args).toEqual([
    "monitor",
    "--port",
    "COM42",
    "--environment",
    "fixture",
  ]);
  expect(options.env.PYTHONUNBUFFERED).toBe("1");
  expect(getMonitorStatus("COM42", root)).toMatchObject({ state: "active" });
  state.alive = false;
  expect(getMonitorStatus("COM42", root)).toMatchObject({ state: "stale" });
  delete state.pids.COM42;
  expect(getMonitorStatus("COM42", root)).toMatchObject({ state: "stale" });
});

it("keeps the embedded Windows monitor alive without a console and exits on reader disconnect", () => {
  const setup = String.raw`
import os, sys, types, runpy, threading, time, json
class Base: pass
class Terminal:
    alive = True
mini = types.SimpleNamespace(ConsoleBase=Base, Miniterm=Terminal)
sys.modules["serial"] = types.ModuleType("serial")
sys.modules["serial.tools"] = types.SimpleNamespace(miniterm=mini)
def invoke(name, run_name):
    assert name == "platformio" and run_name == "__main__"
    assert sys.argv == ["platformio", "device", "monitor", "--port", "COM42"]
    assert mini.Console is Base
    terminal = Terminal()
    worker = threading.Thread(target=terminal.writer)
    worker.start()
    time.sleep(0.15)
    assert worker.is_alive()
    terminal.alive = False
    worker.join(1)
    assert not worker.is_alive()
    print("headless reconnect lifecycle passed")
runpy.run_module = invoke
os.name = "nt"
sys.argv = ["bridge", "pio", "device", "monitor", "--port", "COM42"]
`;
  const output = execFileSync(
    process.platform === "win32" ? "python" : "python3",
    ["-c", setup + PIO_MONITOR_BRIDGE],
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  );
  expect(output.trim()).toBe("headless reconnect lifecycle passed");
});
