import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate from the developer's real ~/.platformio-mcp. Must be set before the
// modules below are imported, because paths.ts resolves the data dir at import
// time. Otherwise these tests write and delete real claim files and PID
// registries that a live monitor depends on.
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pio-monitor-"));
process.env.PIO_MCP_DATA_DIR = TEST_DATA_DIR;

afterAll(() => fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }));

// killPioMonitorByPort verifies the monitor's process identity before and
// after a real SIGKILL, so driving it through a genuinely spawned-and-killed
// process depends on OS reaping timing and is flaky. Wrapping it with vi.fn()
// lets each test pin its outcome -- resolved true (kill confirmed), resolved
// false (nothing to kill), or a throw (identity unverified / exit not
// confirmed) -- and deterministically test stopMonitor's own decision
// (force only on a proven kill, expectedType: "monitor"), which is the logic
// this suite is about. Every other test keeps the real implementation via
// the wrapped default.
vi.mock("../src/utils/process-manager.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/utils/process-manager.js")>();
  return {
    ...actual,
    killPioMonitorByPort: vi.fn(actual.killPioMonitorByPort),
  };
});

const { stopMonitor, queryLogs } = await import("../src/tools/monitor.js");
const processManager = await import("../src/utils/process-manager.js");
const { registerPioMonitorPid, unregisterPioMonitorPid } = processManager;
const { SERVER_DATA_DIR, GLOBAL_LOCKS_DIR, sanitizePortName } =
  await import("../src/utils/paths.js");
const { portSemaphoreManager } = await import("../src/utils/semaphore.js");
const { PlatformIOError } = await import("../src/utils/errors.js");

function claimFile(port: string) {
  return path.join(GLOBAL_LOCKS_DIR, `${sanitizePortName(port)}.json`);
}

function writeRawClaim(port: string, claim: Record<string, unknown>) {
  fs.mkdirSync(GLOBAL_LOCKS_DIR, { recursive: true });
  fs.writeFileSync(
    claimFile(port),
    JSON.stringify({ status: "busy", current_claim: claim }, null, 2),
  );
}

describe("Monitor API", () => {
  const testProjectDir = path.join(process.cwd(), "test-project-monitor");

  beforeEach(() => {
    if (!fs.existsSync(testProjectDir)) {
      fs.mkdirSync(testProjectDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  it("registers and unregisters PIO monitor PID correctly in workspace", async () => {
    await registerPioMonitorPid("COM1", 12345, testProjectDir);
    const pidsFilePath = path.join(
      SERVER_DATA_DIR,
      "serial_monitors",
      "monitor-pids.json",
    );

    expect(fs.existsSync(pidsFilePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(pidsFilePath, "utf8"));
    expect(content["COM1"]).toBe(12345);

    await unregisterPioMonitorPid("COM1", testProjectDir);
    const updatedContent = JSON.parse(fs.readFileSync(pidsFilePath, "utf8"));
    expect(updatedContent["COM1"]).toBeUndefined();
  });

  it("fails gracefully when queryLogs called on missing port log", async () => {
    const result = await queryLogs(10, undefined, testProjectDir, "COM99");
    expect(result.success).toBe(false);
    expect(result.content).toMatch(/No active or recent logs found/);
  });

  describe("stopMonitor claim release", () => {
    // A port with no in-process activeDaemons entry, exercising the path a
    // CLI process takes: killPioMonitorByPort runs, then stopMonitor must
    // decide -- based on whether the kill was PROVEN and whether the
    // surviving claim is on THIS host -- whether it is safe to clear a claim
    // it never held in its own activeDaemons map.
    //
    // Claims below use owner_pid: 1 (not process.pid) with a SAME-host
    // hostname where the test needs the force path specifically exercised:
    // pid 1 is always alive and, for isOwnedByThisProcess/isClaimStale's
    // purposes, definitely not us, so the non-force ownership/staleness path
    // would refuse to release it -- only `force: true` can. Using our own
    // pid instead would make isOwnedByThisProcess true and the non-force
    // path would release it anyway, masking whether force actually mattered.
    const PORT = "/dev/cu.test-monitor-stop";

    afterEach(() => {
      fs.rmSync(claimFile(PORT), { force: true });
    });

    it("leaves a live monitor claim intact when the kill is not proven", async () => {
      vi.mocked(processManager.killPioMonitorByPort).mockResolvedValueOnce(
        false,
      );
      writeRawClaim(PORT, {
        type: "monitor",
        owner_workspace: "/tmp/other-workspace",
        owner_pid: process.ppid, // alive, not us, on every platform (PID 1 does not exist on Windows)
        hostname: os.hostname(),
        timestamp: Date.now(),
      });

      await stopMonitor(PORT, testProjectDir);

      const claim = portSemaphoreManager.getClaim(PORT);
      expect(claim).not.toBeNull();
      expect(claim?.type).toBe("monitor");
    });

    it("leaves a live monitor claim intact when the kill throws (identity unverified)", async () => {
      // killPioMonitorByPort refuses a PID-only kill when the recorded
      // process identity no longer matches, and throws rather than
      // returning false. stopMonitor must treat that exactly like "not
      // proven": no force release, and the claim survives.
      vi.mocked(processManager.killPioMonitorByPort).mockRejectedValueOnce(
        new PlatformIOError(
          "Monitor process identity is unavailable or changed; refusing PID-only termination.",
          "PROCESS_IDENTITY_UNVERIFIED",
        ),
      );
      writeRawClaim(PORT, {
        type: "monitor",
        owner_workspace: "/tmp/other-workspace",
        owner_pid: process.ppid,
        hostname: os.hostname(),
        timestamp: Date.now(),
      });

      await expect(stopMonitor(PORT, testProjectDir)).resolves.not.toThrow();

      const claim = portSemaphoreManager.getClaim(PORT);
      expect(claim).not.toBeNull();
      expect(claim?.type).toBe("monitor");
    });

    it("leaves a live monitor claim intact when no PID is tracked for the port at all (real killPioMonitorByPort, not mocked)", async () => {
      // No registerPioMonitorPid call for this port and no matching
      // command-history entry: killPioMonitorByPort's own targetPid lookup
      // finds nothing, so its REAL "no PID found" branch resolves false --
      // flipping that branch to `true` left the whole suite green once,
      // because every other not-proven case in this file is driven through
      // the process-manager mock rather than that real branch.
      writeRawClaim(PORT, {
        type: "monitor",
        owner_workspace: "/tmp/other-workspace",
        owner_pid: process.ppid, // alive, not us, on every platform (PID 1 does not exist on Windows)
        hostname: os.hostname(),
        timestamp: Date.now(),
      });

      await stopMonitor(PORT, testProjectDir);

      const claim = portSemaphoreManager.getClaim(PORT);
      expect(claim).not.toBeNull();
      expect(claim?.type).toBe("monitor");
    });

    it("clears a live monitor claim on this host once the kill is proven", async () => {
      vi.mocked(processManager.killPioMonitorByPort).mockResolvedValueOnce(
        true,
      );
      writeRawClaim(PORT, {
        type: "monitor",
        owner_workspace: "/tmp/other-workspace",
        owner_pid: process.ppid, // alive, not us, on every platform (PID 1 does not exist on Windows)
        hostname: os.hostname(),
        timestamp: Date.now(),
      });

      await stopMonitor(PORT, testProjectDir);

      expect(portSemaphoreManager.getClaim(PORT)).toBeNull();
    });

    it("leaves a live foreign-HOST monitor claim intact even when the kill is proven", async () => {
      // `proven` is established by killing a PID found in THIS host's own
      // pidsFile/command-history, so it says nothing about a monitor claim
      // published by a different host on shared storage. Force-clearing this
      // would let host A's stopMonitor steal host B's still-live claim.
      vi.mocked(processManager.killPioMonitorByPort).mockResolvedValueOnce(
        true,
      );
      writeRawClaim(PORT, {
        type: "monitor",
        owner_workspace: "/tmp/other-workspace",
        owner_pid: process.pid,
        hostname: "some-other-host",
        timestamp: Date.now(),
      });

      await stopMonitor(PORT, testProjectDir);

      const claim = portSemaphoreManager.getClaim(PORT);
      expect(claim).not.toBeNull();
      expect(claim?.type).toBe("monitor");
      expect(claim?.hostname).toBe("some-other-host");
    });

    it("leaves a live upload claim on this host intact even when the kill is proven", async () => {
      vi.mocked(processManager.killPioMonitorByPort).mockResolvedValueOnce(
        true,
      );
      writeRawClaim(PORT, {
        type: "upload",
        owner_workspace: "/tmp/other-workspace",
        owner_pid: process.ppid, // alive, not us, on every platform (PID 1 does not exist on Windows)
        hostname: os.hostname(),
        timestamp: Date.now(),
      });

      await stopMonitor(PORT, testProjectDir);

      const claim = portSemaphoreManager.getClaim(PORT);
      expect(claim).not.toBeNull();
      expect(claim?.type).toBe("upload");
    });
  });
});
