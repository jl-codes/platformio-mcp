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
import { spawn } from "node:child_process";

// Isolate from the developer's real ~/.platformio-mcp. Must be set before the
// modules below are imported, because paths.ts resolves the data dir at import
// time. Otherwise these tests write and delete real claim files and PID
// registries that a live monitor depends on.
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pio-monitor-"));
process.env.PIO_MCP_DATA_DIR = TEST_DATA_DIR;

afterAll(() => fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }));

// killPioMonitorByPort's "proven" flag depends on real OS process-reaping
// timing (see the module's own Step 4a comment): a synchronous liveness probe
// taken immediately after SIGKILL can still see a not-yet-reaped zombie of our
// own child, so driving it via a genuinely spawned-and-killed process is
// flaky. Wrapping it with vi.fn() lets each test pin an exact
// { proven, pid } result and deterministically test stopMonitor's own
// decision (force: killResult.proven, expectedType: "monitor") -- which is
// the actual logic this task changed -- while every other test keeps the
// real implementation via the wrapped default.
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

function spawnLongRunningChild(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000);"],
      {
        stdio: "ignore",
      },
    );
    child.once("spawn", () => resolve(child.pid!));
    child.once("error", reject);
  });
}

// PID 1 (launchd/init) is always alive, on this host, and -- for a non-root
// test runner -- not signalable by us, so process.kill(1, 0) throws EPERM
// rather than ESRCH. isClaimStale and confirmProcessGone both treat that as
// "not proven dead", which is exactly the "alive, same host, not owned by
// this process" fixture several tests below need without spawning a process
// just to stand in as someone else's PID. Some of those tests only need "not
// owned by us and not stale"; confirmProcessGone(1) additionally pins the
// EPERM branch itself, which only fires this way for a non-root runner (as
// root, kill(1, 0) never throws, so that test is skipped below rather than
// silently passing for the wrong reason).
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

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
      vi.mocked(processManager.killPioMonitorByPort).mockResolvedValueOnce({
        proven: false,
      });
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

    it("leaves a live monitor claim intact when no PID is tracked for the port at all (real killPioMonitorByPort, not mocked)", async () => {
      // No registerPioMonitorPid call for this port and no matching
      // command-history entry: killPioMonitorByPort's own targetPid lookup
      // finds nothing, so its REAL "no PID found" branch resolves
      // { proven: false } -- this is the mutant the review found: flipping
      // that branch's `proven: false` to `true` left the whole suite green,
      // because every other proven=false case in this file is driven through
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
      vi.mocked(processManager.killPioMonitorByPort).mockResolvedValueOnce({
        proven: true,
        pid: 424242,
      });
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
      vi.mocked(processManager.killPioMonitorByPort).mockResolvedValueOnce({
        proven: true,
        pid: 424242,
      });
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
      vi.mocked(processManager.killPioMonitorByPort).mockResolvedValueOnce({
        proven: true,
        pid: 424242,
      });
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

describe("killPioMonitorByPort real proven/confirmProcessGone wiring", () => {
  // stopMonitor's decision logic is tested above against a mocked
  // killPioMonitorByPort, and confirmProcessGone's own polling is tested
  // directly below -- but nothing so far exercises killPioMonitorByPort
  // itself actually calling the real confirmProcessGone and forwarding its
  // result. Mutating `proven = await confirmProcessGone(targetPid)` to
  // `proven = true` left the whole suite green without this test.
  //
  // A SIGKILL always terminates a process we have permission to sign, so the
  // only way to exercise "tree-kill reported success but the process is
  // still alive" is to intercept the actual signal delivery. process.kill is
  // stubbed for the duration of this one test only (saved/restored, not a
  // describe-level hook) so it never affects the real-process tests
  // elsewhere in this file.
  const PORT = "/dev/cu.test-killPioMonitorByPort-wiring";
  const wiringProjectDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pio-monitor-wiring-"),
  );

  afterAll(() => fs.rmSync(wiringProjectDir, { recursive: true, force: true }));

  it('reports proven: false when the kill "succeeds" but the target is still alive', async () => {
    const originalKill = process.kill;
    process.kill = vi.fn(() => true) as unknown as typeof process.kill;
    try {
      // This process's own pid stands in for the monitor's; process.kill is
      // stubbed, so nothing real is signaled and the test runner is never at
      // risk.
      await registerPioMonitorPid(PORT, process.pid, wiringProjectDir);

      const result = await processManager.killPioMonitorByPort(
        PORT,
        wiringProjectDir,
      );

      expect(result.proven).toBe(false);
    } finally {
      process.kill = originalKill;
    }
  });
});

describe("confirmProcessGone", () => {
  // killPioMonitorByPort's own liveness probe is exercised here directly
  // (rather than only indirectly through the mocked stopMonitor tests above):
  // a single synchronous process.kill(pid, 0) right after SIGKILL is racy,
  // because a killed child of this process is a zombie -- still visible to
  // kill(pid, 0) -- until libuv reaps it. The poll is what makes this
  // deterministic: it absorbs that reaping delay instead of guessing at it.
  it("confirms a real killed child process is gone, absorbing the zombie-reap delay", async () => {
    const pid = await spawnLongRunningChild();

    process.kill(pid, "SIGKILL");

    const proven = await processManager.confirmProcessGone(pid);
    expect(proven).toBe(true);
  });

  it("returns false when the process is still alive once the budget runs out", async () => {
    // This test process's own PID is guaranteed alive for a 50ms budget.
    const proven = await processManager.confirmProcessGone(process.pid, 50);
    expect(proven).toBe(false);
  });

  it("returns true immediately for a PID that was never alive", async () => {
    // Regression guard for the ESRCH branch itself, independent of timing.
    const proven = await processManager.confirmProcessGone(999999, 50);
    expect(proven).toBe(true);
  });

  // Pins the EPERM branch specifically: without this, `catch (error) {
  // return error.code === "ESRCH"; }` could be "simplified" to
  // `return true` and the two tests above would not notice, since neither
  // exercises a PID that is alive, foreign, and NOT ours to signal. Skipped
  // as root: kill(1, 0) never throws for root, so the budget-timeout path
  // would produce `false` regardless of the catch body, giving a false pass
  // rather than actually pinning anything.
  it.skipIf(isRoot || process.platform === "win32")(
    "returns false for a live PID we do not have permission to signal (EPERM, not ESRCH)",
    async () => {
      const proven = await processManager.confirmProcessGone(1, 50);
      expect(proven).toBe(false);
    },
  );
});
