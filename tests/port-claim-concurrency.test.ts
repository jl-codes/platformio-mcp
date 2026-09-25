import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Isolate from the developer's real data dir. Must be set before importing paths.
const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pio-claim-"));
process.env.PIO_MCP_DATA_DIR = TMP_DATA_DIR;

const { GLOBAL_LOCKS_DIR, sanitizePortName } =
  await import("../src/utils/paths.js");

const PORT_A = "/dev/cu.concurrency-a";
const PORT_B = "/dev/cu.concurrency-b";
// A bare absolute path fails on Windows with ERR_UNSUPPORTED_ESM_URL_SCHEME.
const SEMAPHORE = pathToFileURL(path.resolve("build/utils/semaphore.js")).href;

function claimFile(port: string) {
  return path.join(GLOBAL_LOCKS_DIR, `${sanitizePortName(port)}.json`);
}

/**
 * Child that waits for a shared wall-clock start time, then claims.
 *
 * Two details are load-bearing:
 *
 * 1. The barrier makes the attempts genuinely simultaneous. Without it the OS
 *    almost always serialises them and no race ever appears.
 * 2. `holdMs` keeps a winner ALIVE until the round is over. This is not
 *    padding. Staleness is decided by probing the owner's PID, so a child that
 *    claims and exits immediately leaves a claim that is *correctly* stale, and
 *    a later racer legitimately reclaims it — producing two "winners" and a
 *    flaky test that looks like a locking bug but is not one. A real flash
 *    holds the port for its whole duration; the test must model that.
 */
function raceScript(port: string, startAtMs: number, holdMs = 1500) {
  return `
    const wait = ${startAtMs} - Date.now();
    if (wait > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    import(${JSON.stringify(SEMAPHORE)}).then(m => {
      let result;
      try {
        m.portSemaphoreManager.claimPort(${JSON.stringify(port)}, "Firmware Upload");
        result = JSON.stringify({ ok: true, code: "" });
      } catch (e) {
        result = JSON.stringify({ ok: false, code: e.code ?? "UNKNOWN" });
      }
      // Stay alive so a winner's PID remains probeable for the whole round.
      setTimeout(() => process.stdout.write(result), ${holdMs});
    });
  `;
}

function spawnRacer(port: string, startAtMs: number) {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", raceScript(port, startAtMs)],
    {
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env, PIO_MCP_DATA_DIR: TMP_DATA_DIR },
    },
  );
  return new Promise<{ ok: boolean; code: string }>((resolve) => {
    let out = "";
    child.stdout.on("data", (c) => (out += String(c)));
    child.on("exit", () => {
      try {
        resolve(JSON.parse(out.trim()));
      } catch {
        resolve({ ok: false, code: "NO_OUTPUT" });
      }
    });
  });
}

/** Runs claimPort in one separate process, no barrier. */
function claimInChildProcess(port: string): { ok: boolean; code: string } {
  const out = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", raceScript(port, 0, 0)],
    {
      encoding: "utf8",
      env: { ...process.env, PIO_MCP_DATA_DIR: TMP_DATA_DIR },
    },
  );
  return JSON.parse(out.trim());
}

/**
 * Rounds per concurrent scenario.
 *
 * Mutation testing measured this directly: every mutant these loops catch
 * (an unconditional write, a breaker that auto-recovers) fails in round 0,
 * deterministically. Conversely, with the reclaim breaker REMOVED entirely the
 * 8-way race passed 60/60 rounds -- link() is already atomic and the recheck
 * refuses a live claim, so the breaker only closes a microsecond window an
 * 8-way race with a ~5ms spread never hits. That mutant is caught by the
 * deterministic breaker-existence tests instead. 25 rounds cost ~110s of a
 * ~150s suite and added no coverage over one; 5 keeps a margin for barrier
 * jitter on a loaded CI box without the cost.
 */
const ROUNDS = 5;

describe("cross-process port claims", () => {
  beforeEach(() => {
    fs.rmSync(claimFile(PORT_A), { force: true });
    fs.rmSync(claimFile(PORT_B), { force: true });
    fs.rmSync(`${claimFile(PORT_A)}.reclaim`, { force: true });
  });
  afterEach(() => {
    fs.rmSync(claimFile(PORT_A), { force: true });
    fs.rmSync(claimFile(PORT_B), { force: true });
    fs.rmSync(`${claimFile(PORT_A)}.reclaim`, { force: true });
  });

  afterAll(() => {
    fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true });
  });

  it("lets a second CLI invocation reclaim the claim of one that exited", () => {
    // This is the property that makes the CLI-first model usable: each
    // `pio-agent` invocation exits, so its claim is owned by a dead PID and the
    // next invocation reclaims it rather than being locked out. Exclusion comes
    // from LIVE holders, not from claim files outliving their process.
    //
    // execFileSync blocks until the child has exited, so the first claimant is
    // already gone when the second runs. Do not "fix" this by giving the
    // sequential helper a holdMs: exclusion against a live holder is covered by
    // the spawn-based test at the end of this file.
    const first = claimInChildProcess(PORT_A);
    const second = claimInChildProcess(PORT_A);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it("lets two processes claim two different ports", () => {
    expect(claimInChildProcess(PORT_A).ok).toBe(true);
    expect(claimInChildProcess(PORT_B).ok).toBe(true);
  });

  it("lets exactly one of 8 simultaneous processes win, over ROUNDS rounds", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      fs.rmSync(claimFile(PORT_A), { force: true });
      const startAt = Date.now() + 250; // barrier
      const results = await Promise.all(
        Array.from({ length: 8 }, () => spawnRacer(PORT_A, startAt)),
      );
      const winners = results.filter((r) => r.ok).length;
      expect(winners, `round ${round}: ${JSON.stringify(results)}`).toBe(1);
    }
  }, 120000);

  it("lets exactly one of 8 simultaneous processes reclaim one stale claim, over ROUNDS rounds", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      // Seed a stale claim: dead PID on this host.
      fs.mkdirSync(GLOBAL_LOCKS_DIR, { recursive: true });
      fs.writeFileSync(
        claimFile(PORT_A),
        JSON.stringify({
          status: "busy",
          current_claim: {
            type: "upload",
            owner_workspace: "/tmp/dead",
            owner_pid: 999999,
            hostname: os.hostname(),
            timestamp: Date.now(),
            port: PORT_A,
          },
        }),
      );
      const startAt = Date.now() + 250; // barrier
      const results = await Promise.all(
        Array.from({ length: 8 }, () => spawnRacer(PORT_A, startAt)),
      );
      const winners = results.filter((r) => r.ok).length;
      expect(winners, `round ${round}: ${JSON.stringify(results)}`).toBe(1);
    }
  }, 120000);

  it("refuses to auto-recover an abandoned breaker, over ROUNDS rounds", async () => {
    // Regression test for the ABA in the breaker's own recovery path: two
    // processes both judging a breaker abandoned must not both proceed.
    for (let round = 0; round < ROUNDS; round++) {
      fs.mkdirSync(GLOBAL_LOCKS_DIR, { recursive: true });
      fs.writeFileSync(
        claimFile(PORT_A),
        JSON.stringify({
          status: "busy",
          current_claim: {
            type: "upload",
            owner_workspace: "/tmp/dead",
            owner_pid: 999999,
            hostname: os.hostname(),
            timestamp: Date.now(),
            port: PORT_A,
          },
        }),
      );
      // An abandoned breaker, older than BREAKER_TTL_MS.
      const breaker = `${claimFile(PORT_A)}.reclaim`;
      fs.writeFileSync(
        breaker,
        JSON.stringify({ pid: 999999, hostname: os.hostname(), at: 0 }),
      );
      const old = new Date(Date.now() - 120_000);
      fs.utimesSync(breaker, old, old);

      const startAt = Date.now() + 250; // barrier
      const results = await Promise.all(
        Array.from({ length: 8 }, () => spawnRacer(PORT_A, startAt)),
      );
      // No auto-recovery by design: an abandoned breaker wedges the port until
      // `port release` clears it, so NOBODY wins and everybody is told why.
      const winners = results.filter((r) => r.ok).length;
      expect(winners, `round ${round}: ${JSON.stringify(results)}`).toBe(0);
      expect(results.every((r) => r.code === "PORT_BUSY")).toBe(true);
      fs.rmSync(breaker, { force: true });
    }
  }, 120000);

  it("reclaims a claim whose owner process has died", async () => {
    const holder = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import(${JSON.stringify(SEMAPHORE)}).then(m => {
           m.portSemaphoreManager.claimPort(${JSON.stringify(PORT_A)}, "Firmware Upload");
           console.log("held");
           setInterval(() => {}, 1000);
         });`,
      ],
      {
        stdio: ["ignore", "pipe", "inherit"],
        env: { ...process.env, PIO_MCP_DATA_DIR: TMP_DATA_DIR },
      },
    );

    await new Promise<void>((resolve) => {
      holder.stdout.on("data", (chunk) => {
        if (String(chunk).includes("held")) resolve();
      });
    });

    expect(claimInChildProcess(PORT_A).ok).toBe(false);

    holder.kill("SIGKILL");
    await new Promise<void>((resolve) => holder.on("exit", () => resolve()));

    expect(claimInChildProcess(PORT_A).ok).toBe(true);
  }, 30000);
});
