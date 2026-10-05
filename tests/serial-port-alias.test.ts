/** Serial aliases share monitor tracking and port claims; process signals and device metadata are mocked. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const state = vi.hoisted(() => ({
  inspect: vi.fn(),
  kill: vi.fn(),
  updateTask: vi.fn(),
  history: [] as any[],
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
  updateTaskStatus: state.updateTask,
  getCommandHistory: () => state.history,
}));

const previousDataDir = process.env.PIO_MCP_DATA_DIR;
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pio-port-alias-"));
process.env.PIO_MCP_DATA_DIR = testRoot;
process.once("exit", () =>
  fs.rmSync(testRoot, { recursive: true, force: true }),
);
afterAll(() => {
  if (previousDataDir === undefined) delete process.env.PIO_MCP_DATA_DIR;
  else process.env.PIO_MCP_DATA_DIR = previousDataDir;
});

const { canonicalPortName, GLOBAL_LOCKS_DIR } =
  await import("../src/utils/paths.js");
const { portSemaphoreManager } = await import("../src/utils/semaphore.js");
const {
  registerPioMonitorPid,
  unregisterPioMonitorPid,
  killPioMonitorByPort,
  getActiveMonitorPids,
} = await import("../src/utils/process-manager.js");

const directPort = "/dev/ttyUSB37";
const idAlias = "/dev/serial/by-id/usb-test-monitor";
const pathAlias = "/dev/serial/by-path/test-monitor";
const monitorPid = 12345;
const identity = {
  pid: monitorPid,
  platform: process.platform,
  startToken: "original-monitor",
};
const registryPath = path.join(
  testRoot,
  "serial_monitors",
  "monitor-pids.json",
);
const nativeRealpath = fs.realpathSync.native;

beforeEach(() => {
  vi.spyOn(fs.realpathSync, "native").mockImplementation((port, options) => {
    if ([directPort, idAlias, pathAlias].includes(String(port)))
      return directPort;
    return nativeRealpath(port, options as never);
  });
  state.inspect.mockImplementation((pid: number) => ({
    status: "running",
    identity: { ...identity, pid },
  }));
  state.kill.mockImplementation((_pid, _signal, callback) => {
    state.inspect.mockReturnValue({ status: "absent" });
    callback();
  });
  state.updateTask.mockResolvedValue(undefined);
  state.history = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  for (const directory of [GLOBAL_LOCKS_DIR, path.dirname(registryPath)]) {
    if (!fs.existsSync(directory)) continue;
    for (const file of fs.readdirSync(directory))
      fs.rmSync(path.join(directory, file), { recursive: true, force: true });
  }
});

describe("canonical serial ownership keys", () => {
  it("joins Unix stable aliases and Windows COM spellings", () => {
    expect(canonicalPortName(idAlias)).toBe(directPort);
    expect(canonicalPortName(pathAlias)).toBe(directPort);
    expect(canonicalPortName(directPort)).toBe(directPort);
    expect(canonicalPortName("com42")).toBe("COM42");
    expect(canonicalPortName("\\\\.\\COM42")).toBe("COM42");
  });

  it("fails closed for an unresolved stable alias but retains unplugged direct names", () => {
    expect(() =>
      canonicalPortName("/dev/serial/by-id/missing-monitor"),
    ).toThrow(expect.objectContaining({ code: "SERIAL_ENDPOINT_UNAVAILABLE" }));
    expect(canonicalPortName("/dev/cu.missing-monitor")).toBe(
      "/dev/cu.missing-monitor",
    );
  });

  it("does not let a native path take an alias monitor's upload claim", () => {
    portSemaphoreManager.claimPort(idAlias, "Monitor Daemon");
    expect(portSemaphoreManager.getClaim(directPort)?.type).toBe("monitor");
    expect(() =>
      portSemaphoreManager.claimPort(pathAlias, "Firmware Upload"),
    ).toThrow(expect.objectContaining({ code: "PORT_BUSY" }));
    expect(
      portSemaphoreManager.releasePort(directPort, { expectedType: "monitor" }),
    ).toBe(true);
    expect(portSemaphoreManager.getClaim(idAlias)).toBeNull();
  });
});

describe("canonical monitor process tracking", () => {
  it("starts through one alias and confirms stop through another", async () => {
    await registerPioMonitorPid(idAlias, monitorPid);
    expect(JSON.parse(fs.readFileSync(registryPath, "utf8"))).toEqual({
      [directPort]: monitorPid,
    });
    expect(getActiveMonitorPids()[directPort]).toBe(monitorPid);
    expect(await killPioMonitorByPort(pathAlias)).toBe(true);
    expect(state.kill).toHaveBeenCalledWith(
      monitorPid,
      "SIGKILL",
      expect.any(Function),
    );
    expect(getActiveMonitorPids()).toEqual({});
  });

  it("finds and cleans pre-upgrade raw-alias records while stopping by native name", async () => {
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify({ [idAlias]: monitorPid }));
    fs.writeFileSync(
      `${registryPath}.identities.json`,
      JSON.stringify({ [idAlias]: identity }),
    );
    state.history = [
      {
        id: "old-command",
        tasks: [
          {
            taskId: "old-task",
            type: "monitor",
            status: "running",
            port: idAlias,
            pid: monitorPid,
          },
        ],
      },
    ];
    expect(getActiveMonitorPids()[directPort]).toBe(monitorPid);
    expect(await killPioMonitorByPort(directPort)).toBe(true);
    expect(state.updateTask).toHaveBeenCalledWith(
      "old-command",
      "old-task",
      { status: "terminated" },
      undefined,
    );
    expect(
      JSON.parse(fs.readFileSync(`${registryPath}.identities.json`, "utf8")),
    ).toEqual({});
  });

  it("unregisters canonical tracking via the original alias", async () => {
    await registerPioMonitorPid(directPort, monitorPid);
    await unregisterPioMonitorPid(idAlias);
    expect(getActiveMonitorPids()).toEqual({});
  });

  it("refuses ambiguous legacy aliases without signalling either process", async () => {
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(
      registryPath,
      JSON.stringify({ [idAlias]: monitorPid, [directPort]: monitorPid + 1 }),
    );
    await expect(killPioMonitorByPort(pathAlias)).rejects.toMatchObject({
      code: "PROCESS_IDENTITY_UNVERIFIED",
    });
    expect(state.kill).not.toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(registryPath, "utf8"))).toEqual({
      [idAlias]: monitorPid,
      [directPort]: monitorPid + 1,
    });
  });
});
