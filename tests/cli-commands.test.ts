import { describe, it, expect, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate from the developer's real ~/.platformio-mcp. Must be set before the
// modules below are imported, because paths.ts resolves the data dir at
// import time. Otherwise these tests would read/delete claim files belonging
// to a live monitor. See tests/semaphore.test.ts for the same pattern.
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pio-cli-cmds-"));
process.env.PIO_MCP_DATA_DIR = TEST_DATA_DIR;

afterAll(() => fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }));

// lockStatus/portRelease live in src/cli/commands/lock.ts, which has no
// entry-point side effects of its own, so importing it directly is safe
// (unlike ../src/cli.js, which guards its own `main()` invocation behind an
// is-main-module check for the same reason).
const { lockStatus, portRelease } = await import("../src/cli/commands/lock.js");
const { GLOBAL_LOCKS_DIR, sanitizePortName } =
  await import("../src/utils/paths.js");
const { lib } = await import("../src/cli/commands/lib.js");
const { project } = await import("../src/cli/commands/project.js");
const { logs } = await import("../src/cli/commands/logs.js");
const { boardInfo } = await import("../src/cli/commands/boards.js");
const { systemInfo, dashboard } = await import("../src/cli/commands/system.js");
const { activePortalStatus } = await import("../src/api/server.js");
const { monitorStop } = await import("../src/cli/commands/monitor.js");
const { taskCancel } = await import("../src/cli/commands/task.js");
const { uploadFs } = await import("../src/cli/commands/flash.js");

function claimFile(port: string) {
  return path.join(GLOBAL_LOCKS_DIR, `${sanitizePortName(port)}.json`);
}

function writeClaim(
  port: string,
  claim: Record<string, unknown>,
  file: string = claimFile(port),
) {
  fs.mkdirSync(GLOBAL_LOCKS_DIR, { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ status: "busy", current_claim: claim }, null, 2),
  );
}

describe("lock status", () => {
  it("labels the global lock as process-scoped", async () => {
    const result = (await lockStatus({
      options: {},
      positionals: [],
      jsonMode: true,
    })) as { globalLock: { scope: string } };
    expect(result.globalLock.scope).toBe("process");
  });

  it("lists a seeded claim, and skips .reclaim and .tmp. files", async () => {
    const port = "/dev/cu.cli-lock-list-test";
    writeClaim(port, {
      type: "upload",
      owner_workspace: "/tmp",
      owner_pid: process.pid,
      hostname: os.hostname(),
      timestamp: Date.now(),
      port,
    });

    // Internal files that share the claim's filename prefix but must never
    // be reported as claims themselves, even though they parse as JSON with
    // an owner_pid, so an `includes(".json")` filter bug would be caught.
    const base = claimFile(port);
    fs.writeFileSync(
      `${base}.reclaim`,
      JSON.stringify({
        owner_pid: process.pid,
        pid: process.pid,
        hostname: os.hostname(),
        at: Date.now(),
      }),
    );
    fs.writeFileSync(
      `${base}.tmp.99999.deadbeef`,
      JSON.stringify({
        status: "busy",
        current_claim: { owner_pid: process.pid, type: "upload" },
      }),
    );

    const result = (await lockStatus({
      options: {},
      positionals: [],
      jsonMode: true,
    })) as { portClaims: Array<{ port: string }> };

    const matching = result.portClaims.filter((c) =>
      c.port.includes("cli-lock-list-test"),
    );
    expect(matching).toHaveLength(1);
    expect(matching[0].port).toBe(port);

    fs.rmSync(base, { force: true });
    fs.rmSync(`${base}.reclaim`, { force: true });
    fs.rmSync(`${base}.tmp.99999.deadbeef`, { force: true });
  });

  it("flags a claim from a dead PID on this host as stale", async () => {
    const port = "/dev/cu.cli-lock-stale-test";
    writeClaim(port, {
      type: "upload",
      owner_workspace: "/tmp",
      owner_pid: 999999,
      hostname: os.hostname(),
      timestamp: Date.now(),
      port,
    });

    const result = (await lockStatus({
      options: {},
      positionals: [],
      jsonMode: true,
    })) as { portClaims: Array<{ port: string; stale: boolean }> };

    const claim = result.portClaims.find((c) =>
      c.port.includes("cli-lock-stale-test"),
    );
    expect(claim?.stale).toBe(true);

    fs.rmSync(claimFile(port), { force: true });
  });
});

describe("port release", () => {
  it("requires --port", async () => {
    await expect(
      portRelease({ options: {}, positionals: [], jsonMode: true }),
    ).rejects.toMatchObject({ code: "MISSING_ARGUMENT" });
  });

  it("refuses to clear a live foreign claim without --force", async () => {
    const port = "/dev/cu.cli-release-foreign-test";
    writeClaim(port, {
      type: "upload",
      owner_workspace: "/tmp/other-workspace",
      owner_pid: process.pid,
      hostname: "some-other-host",
      timestamp: Date.now(),
      port,
    });

    const result = (await portRelease({
      options: { port },
      positionals: [],
      jsonMode: true,
    })) as {
      released: boolean;
      previousClaim: { owner_pid: number; owner_workspace: string } | null;
      message: string;
    };

    expect(result.released).toBe(false);
    expect(result.previousClaim?.owner_pid).toBe(process.pid);
    expect(result.message).toContain(String(process.pid));
    expect(result.message).toContain("/tmp/other-workspace");
    expect(fs.existsSync(claimFile(port))).toBe(true);

    fs.rmSync(claimFile(port), { force: true });
  });

  it("clears a live foreign claim with --force", async () => {
    const port = "/dev/cu.cli-release-force-test";
    writeClaim(port, {
      type: "upload",
      owner_workspace: "/tmp/other-workspace",
      owner_pid: process.pid,
      hostname: "some-other-host",
      timestamp: Date.now(),
      port,
    });

    const result = (await portRelease({
      options: { port, force: true },
      positionals: [],
      jsonMode: true,
    })) as { released: boolean };

    expect(result.released).toBe(true);
    expect(fs.existsSync(claimFile(port))).toBe(false);
  });

  it("clears an abandoned reclaim breaker and reports breakerCleared", async () => {
    const port = "/dev/cu.cli-release-breaker-test";
    const breaker = `${claimFile(port)}.reclaim`;
    fs.mkdirSync(GLOBAL_LOCKS_DIR, { recursive: true });
    fs.writeFileSync(
      breaker,
      JSON.stringify({ pid: 999999, hostname: os.hostname(), at: Date.now() }),
    );

    const result = (await portRelease({
      options: { port },
      positionals: [],
      jsonMode: true,
    })) as { breakerCleared: boolean; released: boolean };

    expect(result.breakerCleared).toBe(true);
    // No claim ever existed on this port, so nothing to release.
    expect(result.released).toBe(false);
    expect(fs.existsSync(breaker)).toBe(false);
  });
});

describe("lib command", () => {
  it("rejects an unknown subcommand", async () => {
    await expect(
      lib({ options: {}, positionals: ["bogus"], jsonMode: true }),
    ).rejects.toMatchObject({ code: "UNKNOWN_SUBCOMMAND" });
  });

  it("requires a query for search", async () => {
    await expect(
      lib({ options: {}, positionals: ["search"], jsonMode: true }),
    ).rejects.toMatchObject({ code: "MISSING_ARGUMENT" });
  });

  it("requires a name for install", async () => {
    await expect(
      lib({ options: {}, positionals: ["install"], jsonMode: true }),
    ).rejects.toMatchObject({ code: "MISSING_ARGUMENT" });
  });
});

describe("project command", () => {
  it("rejects an unknown subcommand", async () => {
    await expect(
      project({ options: {}, positionals: ["bogus"], jsonMode: true }),
    ).rejects.toMatchObject({ code: "UNKNOWN_SUBCOMMAND" });
  });

  it("requires --project-dir", async () => {
    await expect(
      project({ options: {}, positionals: ["config"], jsonMode: true }),
    ).rejects.toMatchObject({ code: "MISSING_ARGUMENT" });
  });
});

describe("logs command", () => {
  it("rejects an unknown subcommand", async () => {
    await expect(
      logs({ options: {}, positionals: ["bogus"], jsonMode: true }),
    ).rejects.toMatchObject({ code: "UNKNOWN_SUBCOMMAND" });
  });

  it("requires --project-dir for capture", async () => {
    await expect(
      logs({ options: {}, positionals: ["capture"], jsonMode: true }),
    ).rejects.toMatchObject({ code: "MISSING_ARGUMENT" });
  });
});

describe("board-info command", () => {
  it("requires --board or a positional board id", async () => {
    await expect(
      boardInfo({ options: {}, positionals: [], jsonMode: true }),
    ).rejects.toMatchObject({ code: "MISSING_ARGUMENT" });
  });

  it("accepts the board id via --board or positional equivalently", async () => {
    const viaFlag = await boardInfo({
      options: { board: "esp32dev" },
      positionals: [],
      jsonMode: true,
    }).catch((error) => error);
    const viaPositional = await boardInfo({
      options: {},
      positionals: ["esp32dev"],
      jsonMode: true,
    }).catch((error) => error);

    // Neither form should fail argument validation; both reach the same
    // underlying getBoardInfo call, so whatever it does (succeed, or fail
    // e.g. because PlatformIO isn't installed in the test environment)
    // should happen identically for both.
    expect(viaFlag).not.toMatchObject({ code: "MISSING_ARGUMENT" });
    expect(viaPositional).not.toMatchObject({ code: "MISSING_ARGUMENT" });
    expect((viaFlag as { code?: string })?.code).toBe(
      (viaPositional as { code?: string })?.code,
    );
  });
});

describe("system-info command", () => {
  it("takes no arguments and is callable", async () => {
    const result = await systemInfo({
      options: {},
      positionals: [],
      jsonMode: true,
    }).catch((error) => error);
    expect(result).not.toMatchObject({ code: "MISSING_ARGUMENT" });
  });
});

describe("monitor-stop command", () => {
  it("requires --port", async () => {
    await expect(
      monitorStop({ options: {}, positionals: [], jsonMode: true }),
    ).rejects.toMatchObject({ code: "MISSING_ARGUMENT" });
  });
});

describe("task-cancel command", () => {
  it("requires a task id", async () => {
    await expect(
      taskCancel({ options: {}, positionals: [], jsonMode: true }),
    ).rejects.toMatchObject({ code: "MISSING_ARGUMENT" });
  });

  it("accepts the task id via --task-id or positional equivalently", async () => {
    const viaFlag = await taskCancel({
      options: { "task-id": "no-such-task" },
      positionals: [],
      jsonMode: true,
    });
    const viaPositional = await taskCancel({
      options: {},
      positionals: ["no-such-task"],
      jsonMode: true,
    });

    expect(viaFlag).toEqual(viaPositional);
    expect(viaFlag).toMatchObject({ success: false, status: "not_found" });
  });
});

describe("upload-fs command", () => {
  it("requires --project-dir", async () => {
    await expect(
      uploadFs({ options: {}, positionals: [], jsonMode: true }),
    ).rejects.toMatchObject({ code: "MISSING_ARGUMENT" });
  });
});

describe("dashboard command", () => {
  // The dashboard is a long-lived HTTP server; it must start only on
  // explicit human request via --serve. This is the property agents and
  // skills rely on when they poll `dashboard` (no flag) to check whether
  // one is already running: it must never have the side effect of starting
  // one. We deliberately do NOT exercise `dashboard --serve` here (it would
  // bind a real port and block forever) — only the status path and the
  // --port validation, which fail fast before ever calling
  // startPortalServer.
  it("reports status without starting a server by default", async () => {
    expect(activePortalStatus.running).toBe(false);

    const result = (await dashboard({
      options: {},
      positionals: [],
      jsonMode: true,
    })) as Record<string, unknown>;

    expect(result).toBeDefined();
    expect(result.started).toBeUndefined();
    expect(result.running).toBe(false);
    // The defining property: activePortalStatus was never flipped, i.e. no
    // server was bound as a side effect of a plain status check.
    expect(activePortalStatus.running).toBe(false);
  });

  it("rejects a non-numeric --port before starting a server", async () => {
    await expect(
      dashboard({
        options: { serve: true, port: "abc" },
        positionals: [],
        jsonMode: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    // The bad --port must be rejected before startPortalServer is ever
    // reached.
    expect(activePortalStatus.running).toBe(false);
  });
});

describe("CLI policy gate", () => {
  it("maps every registered command to an action the default policy permits", async () => {
    const { COMMANDS, actionForCommand } = await import("../src/cli.js");
    const { evaluatePolicy } =
      await import("../src/core/policy/evaluate-policy.js");

    // This is the gap that let `task-status` ship mapped to an action the
    // default policy denies, breaking every --background workflow the skills
    // tell agents to poll. The handler tests construct a CommandContext by
    // hand and never reach runCliCommand, so nothing else exercises this.
    const denied: string[] = [];
    for (const command of Object.keys(COMMANDS)) {
      const action = actionForCommand(command, []);
      const decision = await evaluatePolicy(
        action,
        { projectDir: process.cwd() },
        {
          workspaceDir: process.cwd(),
          actor: "user",
        },
      );
      // "approval_required" is a legitimate outcome; a flat denial is not.
      if (decision.status === "deny") denied.push(`${command} -> ${action}`);
    }

    expect(denied, `denied by default policy: ${denied.join(", ")}`).toEqual(
      [],
    );
  });
});

describe("mutation survivors at the command level", () => {
  const LIVE_PORT = "/dev/cu.cli-live-test";
  const livePortFile = path.join(
    GLOBAL_LOCKS_DIR,
    `${sanitizePortName(LIVE_PORT)}.json`,
  );
  afterEach(() => fs.rmSync(livePortFile, { force: true }));

  it("lock status reports stale:false for a live same-host claim (M19)", async () => {
    // Only the stale:true direction was asserted, so a handler reporting
    // every claim as stale was green.
    fs.mkdirSync(GLOBAL_LOCKS_DIR, { recursive: true });
    fs.writeFileSync(
      livePortFile,
      JSON.stringify({
        status: "busy",
        current_claim: {
          type: "upload",
          owner_workspace: "/tmp",
          owner_pid: process.pid,
          hostname: os.hostname(),
          timestamp: Date.now(),
          port: LIVE_PORT,
        },
      }),
    );
    const result = (await lockStatus({
      options: {},
      positionals: [],
      jsonMode: true,
    })) as { portClaims: Array<{ port: string; stale: boolean }> };
    const row = result.portClaims.find((c) => c.port === LIVE_PORT);
    expect(row).toBeDefined();
    expect(row!.stale).toBe(false);
  });

  it("dashboard reports online when a portal is advertised by a live process (M22)", async () => {
    // The whole point of findRunningPortal was that a one-shot CLI always
    // answered "offline"; nothing asserted the online answer at the command
    // level, so a handler discarding the lookup was green.
    const { SERVER_DATA_DIR } = await import("../src/utils/paths.js");
    const { dashboard } = await import("../src/cli/commands/system.js");
    const stateFile = path.join(SERVER_DATA_DIR, "portal.json");
    fs.mkdirSync(SERVER_DATA_DIR, { recursive: true });
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        pid: process.pid,
        host: "127.0.0.1",
        port: 8123,
        startedAt: Date.now(),
      }),
    );
    try {
      const result = (await dashboard({
        options: {},
        positionals: [],
        jsonMode: true,
      })) as { status: string; running: boolean; port?: number; pid?: number };
      expect(result).toMatchObject({
        status: "online",
        running: true,
        port: 8123,
        pid: process.pid,
      });
    } finally {
      fs.rmSync(stateFile, { force: true });
    }
  });

  it.skipIf(
    !process.env.PATH?.includes("piovenv") && !process.env.PIO_AVAILABLE,
  )(
    "system-info returns PlatformIO's own report, not an empty object (M18)",
    async () => {
      const { systemInfo } = await import("../src/cli/commands/system.js");
      const result = (await systemInfo({
        options: {},
        positionals: [],
        jsonMode: true,
      })) as Record<string, unknown>;
      expect(result).toHaveProperty("core_version");
    },
  );
});
