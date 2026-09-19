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
// time. Otherwise these tests delete claim files belonging to a live monitor.
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pio-sem-"));
process.env.PIO_MCP_DATA_DIR = TEST_DATA_DIR;

afterAll(() => fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }));

const { portSemaphoreManager, PortBusyError, ClaimIoError } =
  await import("../src/utils/semaphore.js");
const { GLOBAL_LOCKS_DIR, sanitizePortName } =
  await import("../src/utils/paths.js");

const PORT = "/dev/cu.test-semaphore";

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

describe("SemaphoreManager staleness", () => {
  beforeEach(() => fs.rmSync(claimFile(PORT), { force: true }));
  afterEach(() => fs.rmSync(claimFile(PORT), { force: true }));

  it("treats a claim from a dead PID on this host as stale", () => {
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp",
      owner_pid: 999999,
      hostname: os.hostname(),
      timestamp: Date.now(),
    });
    const claim = portSemaphoreManager.getClaim(PORT);
    expect(claim).not.toBeNull();
    expect(portSemaphoreManager.isClaimStale(claim!)).toBe(true);
  });

  it("treats a live claim from this process as not stale", () => {
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp",
      owner_pid: process.pid,
      hostname: os.hostname(),
      timestamp: Date.now(),
    });
    const claim = portSemaphoreManager.getClaim(PORT);
    expect(portSemaphoreManager.isClaimStale(claim!)).toBe(false);
  });

  it("treats a claim older than the TTL as stale regardless of host", () => {
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp",
      owner_pid: process.pid,
      hostname: "some-other-host",
      timestamp: Date.now() - 31 * 60 * 1000,
    });
    const claim = portSemaphoreManager.getClaim(PORT);
    expect(portSemaphoreManager.isClaimStale(claim!)).toBe(true);
  });

  it("does not probe PIDs belonging to another host", () => {
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp",
      owner_pid: 999999,
      hostname: "some-other-host",
      timestamp: Date.now(),
    });
    const claim = portSemaphoreManager.getClaim(PORT);
    expect(portSemaphoreManager.isClaimStale(claim!)).toBe(false);
  });

  it("PortBusyError carries the holder details", () => {
    const err = new PortBusyError(PORT, {
      type: "upload",
      owner_workspace: "/tmp/ws",
      owner_pid: 4242,
      hostname: "h",
      timestamp: 1,
    });
    expect(err.code).toBe("PORT_BUSY");
    expect(err.context?.port).toBe(PORT);
    expect(err.message).toContain("4242");
  });

  it("treats a legacy claim (empty hostname) with dead PID and recent timestamp as not stale", () => {
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp",
      owner_pid: 999999,
      hostname: "",
      timestamp: Date.now(),
    });
    const claim = portSemaphoreManager.getClaim(PORT);
    expect(portSemaphoreManager.isClaimStale(claim!)).toBe(false);
  });

  it("treats a legacy claim (empty hostname) with dead PID and old timestamp as stale", () => {
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp",
      owner_pid: 999999,
      hostname: "",
      timestamp: Date.now() - 31 * 60 * 1000,
    });
    const claim = portSemaphoreManager.getClaim(PORT);
    expect(portSemaphoreManager.isClaimStale(claim!)).toBe(true);
  });
});

describe("SemaphoreManager getClaim malformed input", () => {
  beforeEach(() => fs.rmSync(claimFile(PORT), { force: true }));
  afterEach(() => fs.rmSync(claimFile(PORT), { force: true }));

  it("returns null for corrupt JSON", () => {
    fs.mkdirSync(GLOBAL_LOCKS_DIR, { recursive: true });
    fs.writeFileSync(claimFile(PORT), "{ invalid json");
    const claim = portSemaphoreManager.getClaim(PORT);
    expect(claim).toBeNull();
  });

  it("returns null when owner_pid is missing", () => {
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp",
      hostname: os.hostname(),
      timestamp: Date.now(),
    });
    const claim = portSemaphoreManager.getClaim(PORT);
    expect(claim).toBeNull();
  });

  it("returns null when owner_pid is not numeric", () => {
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp",
      owner_pid: "not-a-number",
      hostname: os.hostname(),
      timestamp: Date.now(),
    });
    const claim = portSemaphoreManager.getClaim(PORT);
    expect(claim).toBeNull();
  });
});

describe("SemaphoreManager TTL parsing", () => {
  const originalEnv = process.env.PIO_PORT_CLAIM_TTL_MS;

  beforeEach(() => fs.rmSync(claimFile(PORT), { force: true }));
  afterEach(() => {
    fs.rmSync(claimFile(PORT), { force: true });
    if (originalEnv === undefined) {
      delete process.env.PIO_PORT_CLAIM_TTL_MS;
    } else {
      process.env.PIO_PORT_CLAIM_TTL_MS = originalEnv;
    }
  });

  it("falls back to default TTL for invalid env values", () => {
    process.env.PIO_PORT_CLAIM_TTL_MS = "-100";
    // Foreign hostname: the PID cannot be probed, so this genuinely exercises
    // the TTL fallback path rather than short-circuiting on same-host liveness.
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp",
      owner_pid: process.pid,
      hostname: "some-other-host",
      timestamp: Date.now() - 29 * 60 * 1000,
    });
    const claim = portSemaphoreManager.getClaim(PORT);
    expect(portSemaphoreManager.isClaimStale(claim!)).toBe(false);

    process.env.PIO_PORT_CLAIM_TTL_MS = "0";
    expect(portSemaphoreManager.isClaimStale(claim!)).toBe(false);

    process.env.PIO_PORT_CLAIM_TTL_MS = "abc";
    expect(portSemaphoreManager.isClaimStale(claim!)).toBe(false);

    process.env.PIO_PORT_CLAIM_TTL_MS = "";
    expect(portSemaphoreManager.isClaimStale(claim!)).toBe(false);
  });

  it("honors a valid TTL env value", () => {
    process.env.PIO_PORT_CLAIM_TTL_MS = "60000";
    // Foreign hostname: same reasoning as above — a live same-host PID is now
    // never stale, so this must use an unprobeable host to test the TTL itself.
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp",
      owner_pid: process.pid,
      hostname: "some-other-host",
      timestamp: Date.now() - 70000,
    });
    const claim = portSemaphoreManager.getClaim(PORT);
    expect(portSemaphoreManager.isClaimStale(claim!)).toBe(true);
  });
});

describe("SemaphoreManager claimPort", () => {
  beforeEach(() => fs.rmSync(claimFile(PORT), { force: true }));
  afterEach(() => fs.rmSync(claimFile(PORT), { force: true }));

  it("claims a free port and records this process", () => {
    const claim = portSemaphoreManager.claimPort(PORT, "Firmware Upload");
    expect(claim.owner_pid).toBe(process.pid);
    expect(claim.type).toBe("upload");
    expect(claim.hostname).toBe(os.hostname());
    expect(fs.existsSync(claimFile(PORT))).toBe(true);
  });

  it("classifies a monitor reason as a monitor claim", () => {
    const claim = portSemaphoreManager.claimPort(PORT, "Monitor Daemon");
    expect(claim.type).toBe("monitor");
  });

  it("throws PortBusyError when a live foreign claim exists", () => {
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp/other",
      owner_pid: process.pid,
      hostname: "some-other-host",
      timestamp: Date.now(),
    });
    expect(() =>
      portSemaphoreManager.claimPort(PORT, "Firmware Upload"),
    ).toThrow(PortBusyError);
  });

  it("reclaims a stale claim from a dead PID", () => {
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp/dead",
      owner_pid: 999999,
      hostname: os.hostname(),
      timestamp: Date.now(),
    });
    const claim = portSemaphoreManager.claimPort(PORT, "Firmware Upload");
    expect(claim.owner_pid).toBe(process.pid);
  });

  it("is re-entrant for the same process", () => {
    portSemaphoreManager.claimPort(PORT, "Firmware Upload");
    const second = portSemaphoreManager.claimPort(PORT, "Firmware Upload");
    expect(second.owner_pid).toBe(process.pid);
  });

  it("reclaims a corrupt claim file", () => {
    fs.mkdirSync(GLOBAL_LOCKS_DIR, { recursive: true });
    fs.writeFileSync(claimFile(PORT), "{ not json");
    // Back-date the mtime past the mid-write grace period: a freshly-written
    // unreadable file is presumed to belong to a live writer and must not be
    // reclaimed (see "refuses to reclaim a freshly-unreadable file" below), so
    // this test ages the file to exercise the genuinely-corrupt path instead.
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(claimFile(PORT), old, old);
    const claim = portSemaphoreManager.claimPort(PORT, "Firmware Upload");
    expect(claim.owner_pid).toBe(process.pid);
  });
});

describe("SemaphoreManager claim file classification", () => {
  beforeEach(() => fs.rmSync(claimFile(PORT), { force: true }));
  afterEach(() => {
    fs.rmSync(claimFile(PORT), { force: true });
    fs.rmSync(`${claimFile(PORT)}.reclaim`, { force: true });
  });

  it("refuses to reclaim a freshly-unreadable file, which may be mid-write", () => {
    fs.mkdirSync(GLOBAL_LOCKS_DIR, { recursive: true });
    fs.writeFileSync(claimFile(PORT), "");
    expect(() =>
      portSemaphoreManager.claimPort(PORT, "Firmware Upload"),
    ).toThrow(PortBusyError);
  });

  it("reclaims an unreadable file once it is older than the grace period", () => {
    fs.mkdirSync(GLOBAL_LOCKS_DIR, { recursive: true });
    fs.writeFileSync(claimFile(PORT), "{ not json");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(claimFile(PORT), old, old);
    const claim = portSemaphoreManager.claimPort(PORT, "Firmware Upload");
    expect(claim.owner_pid).toBe(process.pid);
  });

  it("refuses to claim while another process holds the reclaim breaker", () => {
    fs.mkdirSync(GLOBAL_LOCKS_DIR, { recursive: true });
    // A stale claim that would otherwise be reclaimable...
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp/dead",
      owner_pid: 999999,
      hostname: os.hostname(),
      timestamp: Date.now(),
    });
    // ...but someone is already reclaiming it.
    fs.writeFileSync(
      `${claimFile(PORT)}.reclaim`,
      JSON.stringify({ pid: 1, at: Date.now() }),
    );
    expect(() =>
      portSemaphoreManager.claimPort(PORT, "Firmware Upload"),
    ).toThrow(PortBusyError);
  });

  it("releases the breaker after a successful reclaim", () => {
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp/dead",
      owner_pid: 999999,
      hostname: os.hostname(),
      timestamp: Date.now(),
    });
    portSemaphoreManager.claimPort(PORT, "Firmware Upload");
    expect(fs.existsSync(`${claimFile(PORT)}.reclaim`)).toBe(false);
  });

  it("leaves no temp files behind for this port", () => {
    portSemaphoreManager.claimPort(PORT, "Firmware Upload");
    // Scope to this port: an orphan left by any earlier crash, on any port,
    // must not fail a test about this one.
    const base = path.basename(claimFile(PORT));
    const strays = fs
      .readdirSync(GLOBAL_LOCKS_DIR)
      .filter((f) => f.startsWith(`${base}.tmp.`));
    expect(strays).toEqual([]);
  });

  it("keeps a live monitor claim for hours, but not forever (PID reuse cap)", () => {
    // Two real concerns pull opposite ways: a monitor is legitimately held for
    // hours and must not be reclaimed under the user by a flash-sized timer;
    // yet a recycled PID (routine on Windows) must not wedge the port forever.
    // Resolution: monitors get a day-sized TTL, uploads keep the 30-minute one.
    const live = (type: "monitor" | "upload", ageMs: number) => {
      writeRawClaim(PORT, {
        type,
        owner_workspace: "/tmp",
        owner_pid: process.pid,
        hostname: os.hostname(),
        timestamp: Date.now() - ageMs,
      });
      return portSemaphoreManager.isClaimStale(
        portSemaphoreManager.getClaim(PORT)!,
      );
    };
    expect(live("monitor", 12 * 60 * 60 * 1000)).toBe(false); // half a day: still held
    expect(live("monitor", 25 * 60 * 60 * 1000)).toBe(true); // past the cap: reclaimable
    expect(live("upload", 31 * 60 * 1000)).toBe(true); // a flash never takes 31 minutes
    expect(live("upload", 5 * 60 * 1000)).toBe(false);
  });
});

describe("SemaphoreManager reclaim breaker (no auto-recovery)", () => {
  beforeEach(() => fs.rmSync(claimFile(PORT), { force: true }));
  afterEach(() => {
    fs.rmSync(claimFile(PORT), { force: true });
    fs.rmSync(`${claimFile(PORT)}.reclaim`, { force: true });
  });

  it("refuses to claim while any breaker exists, regardless of age or owner", () => {
    fs.mkdirSync(GLOBAL_LOCKS_DIR, { recursive: true });
    // A stale claim that would otherwise be reclaimable...
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp/dead",
      owner_pid: 999999,
      hostname: os.hostname(),
      timestamp: Date.now(),
    });

    // ...but a breaker exists, left by a PID that isn't even this process, and
    // aged well past what the old TTL-based recovery would have honoured.
    // There is no auto-recovery any more: this must be refused unconditionally,
    // and only `clearReclaimBreaker` (pio-agent port release) can clear it.
    const breakerPath = `${claimFile(PORT)}.reclaim`;
    fs.writeFileSync(
      breakerPath,
      JSON.stringify({ pid: 424242, hostname: os.hostname(), at: Date.now() }),
    );
    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(breakerPath, old, old);

    let thrown: unknown;
    try {
      portSemaphoreManager.claimPort(PORT, "Firmware Upload");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PortBusyError);
    expect((thrown as Error).message).toContain("port release");
    // The breaker is untouched: no auto-recovery means no unlink of a breaker
    // we do not own.
    expect(fs.existsSync(breakerPath)).toBe(true);
  });

  it("clearReclaimBreaker removes an abandoned breaker and lets the claim proceed", () => {
    fs.mkdirSync(GLOBAL_LOCKS_DIR, { recursive: true });
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp/dead",
      owner_pid: 999999,
      hostname: os.hostname(),
      timestamp: Date.now(),
    });
    const breakerPath = `${claimFile(PORT)}.reclaim`;
    fs.writeFileSync(
      breakerPath,
      JSON.stringify({ pid: 424242, at: Date.now() }),
    );

    expect(portSemaphoreManager.clearReclaimBreaker(PORT)).toBe(true);
    expect(fs.existsSync(breakerPath)).toBe(false);

    const claim = portSemaphoreManager.claimPort(PORT, "Firmware Upload");
    expect(claim.owner_pid).toBe(process.pid);
  });

  it("clearReclaimBreaker returns false when there is no breaker to clear", () => {
    expect(portSemaphoreManager.clearReclaimBreaker(PORT)).toBe(false);
  });
});

describe("SemaphoreManager releasePort", () => {
  beforeEach(() => fs.rmSync(claimFile(PORT), { force: true }));
  afterEach(() => fs.rmSync(claimFile(PORT), { force: true }));

  it("releases a claim owned by this process", () => {
    portSemaphoreManager.claimPort(PORT, "Firmware Upload");
    expect(portSemaphoreManager.releasePort(PORT)).toBe(true);
    expect(fs.existsSync(claimFile(PORT))).toBe(false);
  });

  it("refuses to release a live foreign claim", () => {
    writeRawClaim(PORT, {
      type: "monitor",
      owner_workspace: "/tmp/other",
      owner_pid: process.pid,
      hostname: "some-other-host",
      timestamp: Date.now(),
    });
    expect(portSemaphoreManager.releasePort(PORT)).toBe(false);
    expect(fs.existsSync(claimFile(PORT))).toBe(true);
  });

  it("releases a live foreign claim when forced", () => {
    writeRawClaim(PORT, {
      type: "monitor",
      owner_workspace: "/tmp/other",
      owner_pid: process.pid,
      hostname: "some-other-host",
      timestamp: Date.now(),
    });
    expect(portSemaphoreManager.releasePort(PORT, { force: true })).toBe(true);
    expect(fs.existsSync(claimFile(PORT))).toBe(false);
  });

  it("releases a stale foreign claim without force", () => {
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp/dead",
      owner_pid: 999999,
      hostname: os.hostname(),
      timestamp: Date.now(),
    });
    expect(portSemaphoreManager.releasePort(PORT)).toBe(true);
  });

  it("returns false when there is nothing to release", () => {
    expect(portSemaphoreManager.releasePort(PORT)).toBe(false);
  });

  it("refuses to release a freshly-unreadable file, which may be mid-write", () => {
    fs.mkdirSync(GLOBAL_LOCKS_DIR, { recursive: true });
    fs.writeFileSync(claimFile(PORT), "");
    expect(portSemaphoreManager.releasePort(PORT)).toBe(false);
    expect(fs.existsSync(claimFile(PORT))).toBe(true);
  });

  it("releases an unreadable file once it is older than the grace period", () => {
    fs.mkdirSync(GLOBAL_LOCKS_DIR, { recursive: true });
    fs.writeFileSync(claimFile(PORT), "{ not json");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(claimFile(PORT), old, old);
    expect(portSemaphoreManager.releasePort(PORT)).toBe(true);
  });
});

describe("SemaphoreManager filesystem fallback", () => {
  beforeEach(() => fs.rmSync(claimFile(PORT), { force: true }));
  afterEach(() => {
    fs.rmSync(claimFile(PORT), { force: true });
    // Reset the one-time warning flag on the singleton so later tests (and
    // runs) can still observe it. There is no exported reset for this, and
    // adding one just for tests isn't worth it; the type-assertion bypass is
    // confined to this file's cleanup.
    (
      portSemaphoreManager as unknown as { warnedNoHardLinks: boolean }
    ).warnedNoHardLinks = false;
  });

  it("falls back to a non-linked exclusive create when the filesystem has no hard links (ENOTSUP)", () => {
    const spy = vi.spyOn(fs, "linkSync").mockImplementationOnce(() => {
      const err = new Error("Operation not supported") as NodeJS.ErrnoException;
      err.code = "ENOTSUP";
      throw err;
    });

    try {
      const claim = portSemaphoreManager.claimPort(PORT, "Firmware Upload");
      expect(claim.owner_pid).toBe(process.pid);
      expect(fs.existsSync(claimFile(PORT))).toBe(true);
      // No temp file survives the fallback path either.
      const base = path.basename(claimFile(PORT));
      const strays = fs
        .readdirSync(GLOBAL_LOCKS_DIR)
        .filter((f) => f.startsWith(`${base}.tmp.`));
      expect(strays).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back on ENOSYS, how Windows FAT32/exFAT surfaces a missing hard-link syscall via libuv", () => {
    const spy = vi.spyOn(fs, "linkSync").mockImplementationOnce(() => {
      const err = new Error(
        "function not implemented",
      ) as NodeJS.ErrnoException;
      err.code = "ENOSYS";
      throw err;
    });

    try {
      const claim = portSemaphoreManager.claimPort(PORT, "Firmware Upload");
      expect(claim.owner_pid).toBe(process.pid);
    } finally {
      spy.mockRestore();
    }
  });

  // POSIX assertion: there, EACCES from link(2) is a real permission problem
  // and must not degrade. On Windows EACCES IS the fallback errno (libuv maps
  // ERROR_ACCESS_DENIED from CreateHardLinkW on FAT32/exFAT/SMB to it).
  it.skipIf(process.platform === "win32")(
    "does not silently degrade on a non-fallback errno from linkSync",
    () => {
      const spy = vi.spyOn(fs, "linkSync").mockImplementationOnce(() => {
        const err = new Error("permission denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      });

      try {
        expect(() =>
          portSemaphoreManager.claimPort(PORT, "Firmware Upload"),
        ).toThrow(ClaimIoError);
        // No claim was written, and no temp file was left behind.
        expect(fs.existsSync(claimFile(PORT))).toBe(false);
        const base = path.basename(claimFile(PORT));
        const strays = fs
          .readdirSync(GLOBAL_LOCKS_DIR)
          .filter((f) => f.startsWith(`${base}.tmp.`));
        expect(strays).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    },
  );
});

describe("monitor claims track the monitor child, not its launcher", () => {
  beforeEach(() => fs.rmSync(claimFile(PORT), { force: true }));
  afterEach(() => fs.rmSync(claimFile(PORT), { force: true }));

  it("is NOT stale while the monitor child lives, even though the launcher exited", () => {
    // The defect this closes: a CLI launcher exits seconds after starting a
    // detached monitor. Probing owner_pid then said "stale", so the next
    // claimer would take a port the monitor still physically holds.
    writeRawClaim(PORT, {
      type: "monitor",
      owner_workspace: "/tmp",
      owner_pid: 999999, // launcher: long gone
      monitor_pid: process.pid, // the child still holding the UART
      hostname: os.hostname(),
      timestamp: Date.now(),
    });
    const claim = portSemaphoreManager.getClaim(PORT);
    expect(claim!.monitor_pid).toBe(process.pid);
    expect(portSemaphoreManager.isClaimStale(claim!)).toBe(false);
  });

  it("IS stale once the monitor child is gone, even though the launcher lives", () => {
    // The inverse: an MCP server stays alive after its monitor died. Probing
    // owner_pid said "live" and wedged the port permanently, since a live
    // same-host PID never expires.
    writeRawClaim(PORT, {
      type: "monitor",
      owner_workspace: "/tmp",
      owner_pid: process.pid, // launcher: still running
      monitor_pid: 999999, // the child: dead
      hostname: os.hostname(),
      timestamp: Date.now(),
    });
    const claim = portSemaphoreManager.getClaim(PORT);
    expect(portSemaphoreManager.isClaimStale(claim!)).toBe(true);
  });

  it("falls back to the launcher PID for claims written without monitor_pid", () => {
    writeRawClaim(PORT, {
      type: "monitor",
      owner_workspace: "/tmp",
      owner_pid: process.pid,
      hostname: os.hostname(),
      timestamp: Date.now(),
    });
    const claim = portSemaphoreManager.getClaim(PORT);
    expect(claim!.monitor_pid).toBeUndefined();
    expect(portSemaphoreManager.isClaimStale(claim!)).toBe(false);
  });

  it("ignores monitor_pid on an upload claim", () => {
    // Only a monitor spawns a detached child; an upload is held by the process
    // doing the flashing, so owner_pid stays authoritative there.
    writeRawClaim(PORT, {
      type: "upload",
      owner_workspace: "/tmp",
      owner_pid: process.pid,
      monitor_pid: 999999,
      hostname: os.hostname(),
      timestamp: Date.now(),
    });
    const claim = portSemaphoreManager.getClaim(PORT);
    expect(portSemaphoreManager.isClaimStale(claim!)).toBe(false);
  });

  it("attachMonitorPid records the child on an existing monitor claim", () => {
    portSemaphoreManager.claimPort(PORT, "Monitor Daemon");
    expect(portSemaphoreManager.attachMonitorPid(PORT, 4242)).toBe(true);
    expect(portSemaphoreManager.getClaim(PORT)!.monitor_pid).toBe(4242);
  });

  it("attachMonitorPid refuses a non-monitor claim", () => {
    portSemaphoreManager.claimPort(PORT, "Firmware Upload");
    expect(portSemaphoreManager.attachMonitorPid(PORT, 4242)).toBe(false);
    expect(portSemaphoreManager.getClaim(PORT)!.monitor_pid).toBeUndefined();
  });
});

describe("re-entrant refresh keeps monitor_pid", () => {
  beforeEach(() => fs.rmSync(claimFile(PORT), { force: true }));
  afterEach(() => fs.rmSync(claimFile(PORT), { force: true }));

  it("a same-process re-claim does not downgrade a monitor claim to launcher-PID staleness", () => {
    // The fresh claim never carries monitor_pid (it is attached only after the
    // child spawns). Writing it verbatim on the re-entrant path silently
    // dropped the field, so the next staleness check probed the launcher.
    portSemaphoreManager.claimPort(PORT, "Monitor Daemon");
    expect(portSemaphoreManager.attachMonitorPid(PORT, 4242)).toBe(true);
    portSemaphoreManager.claimPort(PORT, "Monitor Daemon"); // re-entrant
    expect(portSemaphoreManager.getClaim(PORT)!.monitor_pid).toBe(4242);
  });
});

describe("attachMonitorPid ownership guard (mutation survivor M3)", () => {
  beforeEach(() => fs.rmSync(claimFile(PORT), { force: true }));
  afterEach(() => fs.rmSync(claimFile(PORT), { force: true }));

  it("refuses a monitor claim owned by another process on this host", () => {
    // Writing OUR child's pid into a reclaimed owner's claim would make THEIR
    // port report liveness from OUR child, and their live monitor's port read
    // stale the moment ours exits -- the double-flash this class prevents.
    writeRawClaim(PORT, {
      type: "monitor",
      owner_workspace: "/tmp/other",
      owner_pid: process.ppid, // alive, not us
      hostname: os.hostname(),
      timestamp: Date.now(),
    });
    expect(portSemaphoreManager.attachMonitorPid(PORT, 4242)).toBe(false);
    expect(portSemaphoreManager.getClaim(PORT)!.monitor_pid).toBeUndefined();
  });

  it("refuses a same-PID claim from a foreign host", () => {
    writeRawClaim(PORT, {
      type: "monitor",
      owner_workspace: "/tmp/other",
      owner_pid: process.pid,
      hostname: "some-other-host",
      timestamp: Date.now(),
    });
    expect(portSemaphoreManager.attachMonitorPid(PORT, 4242)).toBe(false);
  });
});

describe("monitor TTL still caps a live monitor_pid (mutation survivor M4)", () => {
  beforeEach(() => fs.rmSync(claimFile(PORT), { force: true }));
  afterEach(() => fs.rmSync(claimFile(PORT), { force: true }));

  it("expires a monitor claim past the monitor TTL even though monitor_pid is live", () => {
    // A recycled monitor_pid would otherwise report "held" forever with no way
    // out but a manual `port release`. The monitor TTL is day-sized, not the
    // flash-sized 30 minutes, so use a fixture older than that.
    writeRawClaim(PORT, {
      type: "monitor",
      owner_workspace: "/tmp",
      owner_pid: 999999,
      monitor_pid: process.pid,
      hostname: os.hostname(),
      timestamp: Date.now() - 25 * 60 * 60 * 1000,
    });
    expect(
      portSemaphoreManager.isClaimStale(portSemaphoreManager.getClaim(PORT)!),
    ).toBe(true);
  });
});
