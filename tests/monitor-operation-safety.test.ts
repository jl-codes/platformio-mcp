/** Regression coverage for monitor startup ownership and failed process cleanup. */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

const testDataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "pio-monitor-operation-"),
);
const previousDataDir = process.env.PIO_MCP_DATA_DIR;
process.env.PIO_MCP_DATA_DIR = testDataDir;
const dependencies = vi.hoisted(() => ({
  spawn: vi.fn(),
  kill: vi.fn(),
  register: vi.fn(),
  treeKill: vi.fn(),
  custodyStatus: vi.fn(),
}));
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: { spawn: dependencies.spawn },
}));
vi.mock("../src/tools/devices.js", () => ({
  findDeviceByPort: vi.fn(async () => null),
  getFirstDevice: vi.fn(async () => null),
}));
vi.mock("../src/utils/process-manager.js", () => ({
  killPioMonitorByPort: dependencies.kill,
  registerPioMonitorPid: dependencies.register,
  getActiveMonitorPids: vi.fn(() => ({})),
  isPidAlive: vi.fn(() => false),
  isBuildActive: vi.fn(() => false),
}));
vi.mock("tree-kill", () => ({ default: dependencies.treeKill }));
vi.mock("../src/core/devices/device-lease.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/core/devices/device-lease.js")
  >()),
  DeviceLeaseStore: class {
    status(resource: unknown) {
      return dependencies.custodyStatus(resource);
    }
  },
}));
vi.mock("../src/core/devices/serial-endpoint.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/core/devices/serial-endpoint.js")
  >()),
  resolveSerialEndpoint: vi.fn((requestedPort: string) => ({
    requestedPort,
    canonicalPort: requestedPort,
    resource: { kind: "serial", identity: `monitor-test:${requestedPort}` },
    revalidate: vi.fn(),
    identityBasis: "windows-port-name",
    presence: "unverified",
    survivesReenumeration: false,
  })),
}));
vi.mock("../src/core/devices/process-identity.js", () => ({
  inspectProcessIdentity: vi.fn((pid: number) => ({
    status: "running",
    identity: { pid, platform: process.platform, startToken: "test-start" },
  })),
  compareProcessIdentity: vi.fn(() => "alive"),
}));

const { startMonitor, stopMonitor, getSpoolerStates } =
  await import("../src/tools/monitor.js");
const { portSemaphoreManager, PortBusyError } =
  await import("../src/utils/semaphore.js");
const { PlatformIOError } = await import("../src/utils/errors.js");
const processIdentity = await import("../src/core/devices/process-identity.js");
const port = "COM42";
const fixturePorts = new Set([port]);

// Pending diagnostic writes can outlive a test on Windows. Remove only after
// the worker can no longer append to these isolated monitor spool files.
process.once("exit", () => {
  try {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  } catch {}
});

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    pid: process.pid,
    exitCode: null,
    signalCode: null,
    unref: vi.fn(),
    kill: vi.fn(() => {
      child.signalCode = "SIGTERM";
      child.emit("exit", null, "SIGTERM");
      return true;
    }),
  });
  return child;
}

describe("monitor operation safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.kill.mockResolvedValue(false);
    dependencies.register.mockResolvedValue(undefined);
    dependencies.spawn.mockResolvedValue(fakeChild());
    dependencies.custodyStatus.mockImplementation((resource) => ({
      status: "unclaimed",
      resource,
    }));
    dependencies.treeKill.mockImplementation((_pid, _signal, callback) =>
      callback(),
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    // Test children are EventEmitters, so no OS process was actually spawned.
    // Confirm their fixture claim stale only during local watcher teardown.
    vi.spyOn(portSemaphoreManager, "isClaimStale").mockReturnValue(true);
    dependencies.kill.mockResolvedValue(true);
    for (const fixturePort of fixturePorts) {
      await stopMonitor(fixturePort, testDataDir);
      portSemaphoreManager.releasePort(fixturePort, { force: true });
    }
    vi.restoreAllMocks();
  });
  afterAll(() => {
    if (previousDataDir === undefined) delete process.env.PIO_MCP_DATA_DIR;
    else process.env.PIO_MCP_DATA_DIR = previousDataDir;
  });

  it("rejects a monitor while this process owns an upload claim", async () => {
    const upload = portSemaphoreManager.claimPort(port, "Firmware Upload");
    await expect(
      startMonitor(port, 115200, testDataDir),
    ).rejects.toBeInstanceOf(PortBusyError);
    expect(dependencies.spawn).not.toHaveBeenCalled();
    expect(portSemaphoreManager.getClaim(port)).toEqual(upload);
  });

  it("refuses orphan upload custody before reclaiming its stale upload claim", async () => {
    const { DeviceLeaseStore: ActualStore } = await vi.importActual<
      typeof import("../src/core/devices/device-lease.js")
    >("../src/core/devices/device-lease.js");
    let ownerRunning = true;
    const store = new ActualStore({
      root: path.join(testDataDir, "orphan-upload-lease"),
      inspect: (pid) =>
        ownerRunning
          ? {
              status: "running",
              identity: {
                pid,
                platform: process.platform,
                startToken: "fixture-owner",
              },
            }
          : { status: "absent" },
    });
    const uploadClaim = portSemaphoreManager.claimPort(port, "Firmware Upload");
    vi.spyOn(portSemaphoreManager, "isClaimStale").mockReturnValue(true);
    const resource = {
      kind: "serial" as const,
      identity: `monitor-test:${port}`,
    };
    const lease = store.acquire(resource);
    store.beginHandoff(lease);
    ownerRunning = false;
    dependencies.custodyStatus.mockImplementation((selected) =>
      store.status(selected),
    );
    try {
      await expect(
        startMonitor(port, 115200, testDataDir),
      ).rejects.toMatchObject({ code: "DEVICE_OWNER_UNKNOWN" });
      expect(dependencies.kill).not.toHaveBeenCalled();
      expect(dependencies.spawn).not.toHaveBeenCalled();
      expect(store.status(resource).status).toBe("unknown");
      expect(portSemaphoreManager.getClaim(port)).toEqual(uploadClaim);
    } finally {
      // No fixture child was started, so this test owns the cleanup capability.
      store.cancelHandoff(lease);
      store.release(lease);
    }
  });

  it.each(["owned", "unknown"] as const)(
    "rejects %s physical custody before monitor preemption",
    async (status) => {
      dependencies.custodyStatus.mockImplementation((resource) => ({
        status,
        resource,
        ownerPid: 999999,
      }));
      await expect(
        startMonitor(port, 115200, testDataDir),
      ).rejects.toMatchObject({
        code: status === "owned" ? "DEVICE_BUSY" : "DEVICE_OWNER_UNKNOWN",
      });
      expect(dependencies.kill).not.toHaveBeenCalled();
      expect(dependencies.spawn).not.toHaveBeenCalled();
      expect(portSemaphoreManager.getClaim(port)).toBeNull();
    },
  );

  it.each(["unclaimed", "stale"] as const)(
    "accepts %s physical custody for monitor startup",
    async (status) => {
      dependencies.custodyStatus.mockImplementation((resource) => ({
        status,
        resource,
      }));
      await expect(
        startMonitor(port, 115200, testDataDir),
      ).resolves.toMatchObject({ success: true });
      expect(dependencies.spawn).toHaveBeenCalledTimes(1);
      expect(dependencies.custodyStatus).toHaveBeenCalledTimes(2);
    },
  );

  it("rechecks physical custody after its claim and before spawning", async () => {
    dependencies.custodyStatus
      .mockImplementationOnce((resource) => ({ status: "unclaimed", resource }))
      .mockImplementationOnce((resource) => ({
        status: "owned",
        resource,
        ownerPid: 999999,
      }));
    await expect(startMonitor(port, 115200, testDataDir)).rejects.toMatchObject(
      { code: "DEVICE_BUSY" },
    );
    expect(dependencies.spawn).not.toHaveBeenCalled();
    expect(portSemaphoreManager.getClaim(port)).toBeNull();
    expect(getSpoolerStates()[port]).toBeUndefined();
  });

  it("rejects concurrent monitor starts before a second child can spawn", async () => {
    let releaseSpawn!: (child: ChildProcess) => void;
    dependencies.spawn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSpawn = resolve;
        }),
    );
    const first = startMonitor(port, 115200, testDataDir);
    await vi.waitFor(() => expect(dependencies.spawn).toHaveBeenCalledTimes(1));
    await expect(
      startMonitor(port, 115200, testDataDir),
    ).rejects.toBeInstanceOf(PortBusyError);
    releaseSpawn(fakeChild());
    await first;
    expect(dependencies.spawn).toHaveBeenCalledTimes(1);
  });

  it("preserves a live monitor and reports a failed identity-verified stop", async () => {
    await startMonitor(port, 115200, testDataDir);
    const before = portSemaphoreManager.getClaim(port);
    const state = getSpoolerStates()[port];
    dependencies.kill.mockRejectedValueOnce(
      new PlatformIOError("Unverified identity", "PROCESS_IDENTITY_UNVERIFIED"),
    );
    await expect(stopMonitor(port, testDataDir)).rejects.toMatchObject({
      code: "PROCESS_IDENTITY_UNVERIFIED",
    });
    expect(portSemaphoreManager.getClaim(port)).toEqual(before);
    expect(getSpoolerStates()[port]).toEqual(state);
  });

  it("does not report stopped when a live monitor has no registry PID", async () => {
    await startMonitor(port, 115200, testDataDir);
    const before = portSemaphoreManager.getClaim(port);
    await expect(stopMonitor(port, testDataDir)).rejects.toMatchObject({
      code: "PROCESS_CLEANUP_PENDING",
    });
    expect(portSemaphoreManager.getClaim(port)).toEqual(before);
    expect(getSpoolerStates()[port]).toBeDefined();
  });

  it("terminates the new child before releasing a failed startup claim", async () => {
    const child = fakeChild();
    dependencies.spawn.mockResolvedValueOnce(child);
    dependencies.treeKill.mockImplementationOnce((_pid, _signal, callback) => {
      expect(portSemaphoreManager.getClaim(port)).not.toBeNull();
      child.signalCode = "SIGKILL";
      child.emit("exit", null, "SIGKILL");
      callback();
    });
    vi.spyOn(portSemaphoreManager, "attachMonitorPid").mockReturnValueOnce(
      false,
    );
    await expect(startMonitor(port, 115200, testDataDir)).rejects.toMatchObject(
      { code: "MONITOR_START_FAILED", context: { cleanupPending: false } },
    );
    expect(dependencies.treeKill).toHaveBeenCalledWith(
      child.pid,
      "SIGKILL",
      expect.any(Function),
    );
    expect(child.unref).not.toHaveBeenCalled();
    expect(portSemaphoreManager.getClaim(port)).toBeNull();
    expect(getSpoolerStates()[port]).toBeUndefined();
  });

  it("retains startup custody when attachment and termination cannot be verified", async () => {
    vi.spyOn(portSemaphoreManager, "attachMonitorPid").mockReturnValueOnce(
      false,
    );
    vi.mocked(processIdentity.inspectProcessIdentity).mockReturnValueOnce({
      status: "unknown",
    });
    await expect(startMonitor(port, 115200, testDataDir)).rejects.toMatchObject(
      {
        code: "PROCESS_CLEANUP_PENDING",
        context: { cleanupPending: true },
      },
    );
    const claim = portSemaphoreManager.getClaim(port);
    expect(claim?.startup_pending).toBe(true);
    expect(
      portSemaphoreManager.isClaimStale({ ...claim!, owner_pid: 999999 }),
    ).toBe(false);
    expect(dependencies.treeKill).not.toHaveBeenCalled();
  });

  it("uses one daemon and transition key for a stable Linux alias", async () => {
    const alias = "/dev/serial/by-id/usb-monitor-safety";
    const nativePort = "/dev/ttyUSB0";
    fixturePorts.add(nativePort);
    const originalRealpath = fs.realpathSync.native;
    vi.spyOn(fs.realpathSync, "native").mockImplementation(
      (target, options) => {
        if (target === alias || target === nativePort) return nativePort;
        return originalRealpath(target, options);
      },
    );
    await startMonitor(alias, 115200, testDataDir);
    expect(getSpoolerStates()[nativePort]).toBeDefined();
    expect(getSpoolerStates()[alias]).toBeUndefined();
    expect(dependencies.spawn).toHaveBeenCalledWith(
      "device",
      expect.arrayContaining(["--port", nativePort]),
      expect.any(Object),
    );
    dependencies.kill.mockResolvedValue(true);
    vi.spyOn(portSemaphoreManager, "isClaimStale").mockReturnValue(true);
    await stopMonitor(nativePort, testDataDir);
    expect(getSpoolerStates()[nativePort]).toBeUndefined();
  });
});
