/** Legacy monitor launch preserves filters and rejects stale process tracking. */
import { execFileSync } from "node:child_process";
import { PIO_MONITOR_BRIDGE } from "../src/utils/pio-monitor-bridge.js";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  spawn: vi.fn(),
  pids: {} as Record<string, number>,
  alive: true,
}));
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: { spawn: state.spawn },
}));
vi.mock("../src/tools/devices.js", () => ({
  findDeviceByPort: async () => ({ hwid: "test" }),
}));
vi.mock("../src/utils/process-manager.js", () => ({
  registerPioMonitorPid: async (port: string, pid: number) => {
    state.pids[port] = pid;
  },
  killPioMonitorByPort: async (port: string) => {
    delete state.pids[port];
    return true;
  },
  getActiveMonitorPids: () => state.pids,
  isPidAlive: () => state.alive,
  isBuildActive: () => false,
}));
import {
  startMonitor,
  stopMonitor,
  getMonitorStatus,
} from "../src/tools/monitor.js";
const roots: string[] = [];
afterEach(async () => {
  await stopMonitor("COM42", roots[0]);
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
  vi.clearAllMocks();
  state.pids = {};
  state.alive = true;
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
