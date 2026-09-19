import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Starts the CLI, captures early output, then kills it. */
function runBriefly(
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["build/cli.js", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => (stderr += String(c)));
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ stdout, stderr });
    }, 1500);
  });
}

/**
 * Starts the CLI, sends an MCP `initialize` JSON-RPC request on stdin, and
 * returns whatever arrives on stdout/stderr before the process is killed.
 * This is the assertion that actually protects the stdio protocol: a test
 * that only greps stderr for "deprecated" would not catch stdout pollution
 * (e.g. a stray console.log) that corrupts MCP JSON-RPC framing.
 */
function probeMcpFraming(
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["build/cli.js", ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => (stderr += String(c)));

    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "cli-entrypoint-test", version: "1.0.0" },
        },
      }) + "\n",
    );

    setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ stdout, stderr });
    }, 2000);
  });
}

describe("CLI entrypoint", () => {
  it("warns on stderr when invoked bare, and keeps stdout clean", async () => {
    const { stdout, stderr } = await runBriefly([]);
    expect(stderr).toContain("deprecated");
    expect(stderr).toContain("pio-agent serve");
    expect(stdout).not.toContain("deprecated");
  }, 10000);

  it("does not warn when invoked as `serve`", async () => {
    const { stderr } = await runBriefly(["serve"]);
    expect(stderr).not.toContain("deprecated");
  }, 10000);

  it("carries valid MCP stdio framing on stdout when invoked bare", async () => {
    const { stdout, stderr } = await probeMcpFraming([]);
    expect(stderr).toContain("deprecated");

    const firstLine = stdout.split("\n").find((line) => line.trim().length > 0);
    expect(firstLine).toBeDefined();
    const parsed = JSON.parse(firstLine as string);
    expect(parsed.jsonrpc).toBe("2.0");
    expect(parsed.id).toBe(1);
    expect(parsed.result).toBeDefined();
    expect(parsed.result.protocolVersion).toBeDefined();
  }, 10000);

  it("carries valid MCP stdio framing on stdout when invoked as `serve`", async () => {
    const { stdout, stderr } = await probeMcpFraming(["serve"]);
    expect(stderr).not.toContain("deprecated");

    const firstLine = stdout.split("\n").find((line) => line.trim().length > 0);
    expect(firstLine).toBeDefined();
    const parsed = JSON.parse(firstLine as string);
    expect(parsed.jsonrpc).toBe("2.0");
    expect(parsed.id).toBe(1);
    expect(parsed.result).toBeDefined();
    expect(parsed.result.protocolVersion).toBeDefined();
  }, 10000);
});

describe("one-shot commands terminate", () => {
  /** Runs a built CLI command, returning how long it took and what it printed. */
  function runCommand(args: string[], budgetMs = 20000) {
    return new Promise<{
      code: number | null;
      ms: number;
      stdout: string;
      hung: boolean;
    }>((resolve) => {
      const t0 = Date.now();
      const child = spawn(process.execPath, ["build/cli.js", ...args], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let settled = false;
      child.stdout.on("data", (c) => (stdout += String(c)));
      child.stderr.resume();
      child.on("exit", (code) => {
        if (settled) return;
        settled = true;
        resolve({ code, ms: Date.now() - t0, stdout, hung: false });
      });
      setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        resolve({ code: null, ms: Date.now() - t0, stdout, hung: true });
      }, budgetMs);
    });
  }

  it("terminates after printing its result (a one-shot command must exit)", async () => {
    // The monitor-specific hang (an un-unref'd fs.watch kept the loop alive
    // after `pio-agent monitor` printed) needs a real serial port to reproduce
    // and is therefore not what this asserts. This pins the general property
    // every command must have, using one that needs no hardware.
    const result = await runCommand(["devices", "--json"]);
    expect(result.hung, "command did not terminate").toBe(false);
  }, 30000);

  it("does not truncate a large payload when exiting", async () => {
    // exitAfterFlush calls process.exit, which truncates a pipe that has not
    // drained. `boards` emits ~500KB, well past the pipe buffer.
    const result = await runCommand(["boards", "--json"]);
    expect(result.hung).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(100_000);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  }, 60000);
});

describe("exit codes reflect failure", () => {
  function exitCodeOf(args: string[]) {
    return new Promise<{ code: number | null; body: string }>((resolve) => {
      const child = spawn(process.execPath, ["build/cli.js", ...args], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (c) => (out += String(c)));
      child.stderr.on("data", (c) => (err += String(c)));
      child.on("exit", (code) =>
        resolve({ code, body: out.trim() || err.trim() }),
      );
    });
  }

  it("exits non-zero when an operation ran but failed", async () => {
    // A build with compiler errors RETURNS success:false rather than throwing,
    // so the exit code used to stay 0 while a thrown error exited 1. Scripts,
    // CI and the skills all tell agents to check $?, and a build tool that
    // exits 0 on a failed build is wrong by any convention.
    const result = await exitCodeOf([
      "target-resolve",
      "--project-dir",
      "/nonexistent-project-xyz",
      "--json",
    ]);
    const parsed = JSON.parse(result.body) as { success: boolean };
    expect(parsed.success).toBe(false);
    expect(result.code).not.toBe(0);
  }, 30000);

  it("exits zero on success", async () => {
    const result = await exitCodeOf(["boards", "--filter", "uno", "--json"]);
    expect(result.code).toBe(0);
  }, 60000);
});

describe("global flags are not swallowed by commands", () => {
  function run(args: string[]) {
    return new Promise<{ code: number | null; out: string; err: string }>(
      (resolve) => {
        const child = spawn(process.execPath, ["build/cli.js", ...args], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        let err = "";
        child.stdout.on("data", (c) => (out += String(c)));
        child.stderr.on("data", (c) => (err += String(c)));
        child.on("exit", (code) => resolve({ code, out, err }));
      },
    );
  }

  it("treats --version after a command as that command's flag", async () => {
    // `--help`/`--version` matched ANYWHERE in argv, so `lib install <name>
    // --version 1.2.3` -- the form the pio-manager skill prescribes -- printed
    // the CLI's own version and installed nothing.
    const result = await run([
      "lib",
      "search",
      "adafruit",
      "--version",
      "1.2.3",
      "--json",
    ]);
    expect(result.out.trim()).not.toMatch(/^\d+\.\d+\.\d+$/);
  }, 60000);

  it("still honours a leading --version", async () => {
    const result = await run(["--version"]);
    expect(result.out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.code).toBe(0);
  }, 30000);

  it("keeps stdout clean when the command is unknown", async () => {
    // Help used to go to stdout, so a caller parsing --json got 3KB of help
    // text where a payload belonged.
    const result = await run(["definitely-not-a-command"]);
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("Unknown command");
  }, 30000);
});

describe("--background returns immediately", () => {
  it("prints status running with a task id and exits before the work finishes", async () => {
    // The spooler's background mode keeps the parent alive to do completion
    // bookkeeping, so `build --background` printed {status:"running"} and then
    // blocked for the whole build -- the opposite of what the skills promise.
    // The CLI now re-execs itself detached. No PlatformIO is needed here: the
    // parent must return before the child even gets as far as failing. Policy
    // evaluation writes an audit entry under the project dir BEFORE the
    // background dispatch, so the dir itself must exist.
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pio-bg-"));
    fs.writeFileSync(
      path.join(projectDir, "platformio.ini"),
      "[env:native]\nplatform = native\n",
    );
    const t0 = Date.now();
    const result = await new Promise<{ code: number | null; out: string }>(
      (resolve) => {
        const child = spawn(
          process.execPath,
          [
            "build/cli.js",
            "build",
            "--project-dir",
            projectDir,
            "--background",
            "--json",
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let out = "";
        child.stdout.on("data", (c) => (out += String(c)));
        child.stderr.resume();
        child.on("exit", (code) => resolve({ code, out }));
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve({ code: null, out });
        }, 10000);
      },
    );
    const elapsed = Date.now() - t0;
    const parsed = JSON.parse(result.out) as {
      status: string;
      taskId?: string;
    };
    expect(parsed.status).toBe("running");
    expect(parsed.taskId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.code).toBe(0);
    expect(elapsed).toBeLessThan(5000);
    fs.rmSync(projectDir, { recursive: true, force: true });
  }, 30000);
});

describe("build freshness", () => {
  it("build/cli.js is not older than src/cli.ts", () => {
    // Every spawn in this file runs build/, not src/. Without this a green run
    // can reflect compiled code that is no longer in src/ -- a mutation audit
    // found exactly that. CI builds first; locally this is the reminder.
    const built = fs.statSync("build/cli.js").mtimeMs;
    const source = fs.statSync("src/cli.ts").mtimeMs;
    expect(
      built >= source,
      "build/cli.js is older than src/cli.ts -- run `npm run build` before these tests",
    ).toBe(true);
  });
});

// The two headline monitor fixes -- the CLI terminating after `monitor`, and
// the claim recording the monitor CHILD's pid -- need a real serial device to
// exercise. Set PIO_TEST_PORT (e.g. /dev/cu.usbserial-0001) to run them; CI
// has no port and skips. Mutation testing showed nothing else guards them.
const TEST_PORT = process.env.PIO_TEST_PORT;
describe.skipIf(!TEST_PORT)("monitor against a real port", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pio-mon-"));
  fs.writeFileSync(
    path.join(projectDir, "platformio.ini"),
    "[env:native]\nplatform = native\n",
  );

  function run(args: string[], budgetMs = 20000) {
    return new Promise<{ code: number | null; out: string; hung: boolean }>(
      (resolve) => {
        const child = spawn(process.execPath, ["build/cli.js", ...args], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        let settled = false;
        child.stdout.on("data", (c) => (out += String(c)));
        child.stderr.resume();
        child.on("exit", (code) => {
          if (!settled) {
            settled = true;
            resolve({ code, out, hung: false });
          }
        });
        setTimeout(() => {
          if (!settled) {
            settled = true;
            child.kill("SIGKILL");
            resolve({ code: null, out, hung: true });
          }
        }, budgetMs);
      },
    );
  }

  it("terminates after starting the monitor (the un-unref'd watcher hang, M8)", async () => {
    const result = await run([
      "monitor",
      "--project-dir",
      projectDir,
      "--port",
      TEST_PORT!,
      "--json",
    ]);
    expect(result.hung, "pio-agent monitor did not exit").toBe(false);
    expect(result.code).toBe(0);
  }, 30000);

  it("records the monitor child's pid on the claim (attachMonitorPid wiring, M23)", async () => {
    const status = await run(["lock", "status", "--json"]);
    const parsed = JSON.parse(status.out) as {
      portClaims: Array<{
        port: string;
        monitorPid?: number;
        ownerPid: number;
      }>;
    };
    const row = parsed.portClaims.find((c) => c.port === TEST_PORT);
    expect(row, "no claim recorded for the test port").toBeDefined();
    expect(typeof row!.monitorPid).toBe("number");
    expect(row!.monitorPid).not.toBe(row!.ownerPid);
    await run([
      "monitor-stop",
      "--port",
      TEST_PORT!,
      "--project-dir",
      projectDir,
      "--json",
    ]);
    fs.rmSync(projectDir, { recursive: true, force: true });
  }, 30000);
});
