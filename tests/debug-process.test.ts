/** Process-owner regressions with synthetic MI pipes; no hardware or real debugger is launched. */
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { spawn } from "node:child_process";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { DebugProcess } from "../src/core/debug/debug-process.js";
let project: string;
beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "pio-debug-owner-"));
  fs.writeFileSync(
    path.join(project, "platformio.ini"),
    "[env:native]\nplatform=native\n",
  );
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { audit_all_agent_actions: false },
    }),
  );
});
afterEach(() => fs.rmSync(project, { recursive: true, force: true }));
function fixture(rejectSetup = false) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: Writable;
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    kill: ReturnType<typeof vi.fn>;
  };
  const lines: string[] = [];
  child.pid = 1234;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(chunk, _encoding, done) {
      const line = chunk.toString();
      lines.push(line);
      const token = /^(\d+)/.exec(line)![1];
      queueMicrotask(() =>
        child.stdout.write(
          token + (rejectSetup ? '^error,msg="unsupported"\n' : "^done\n"),
        ),
      );
      done();
    },
  });
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit("close", null));
    return true;
  });
  const custody = { prepareSpawn: vi.fn(), releaseAfterExit: vi.fn() };
  const confirmProbeReleased = vi.fn(async () => true);
  const launch = vi.fn(() => child);
  const options = {
    executable: path.resolve("trusted-gdb"),
    projectDir: project,
    elfPath: path.join(project, "firmware.elf"),
    custody,
    confirmProbeReleased,
    launch: launch as unknown as typeof spawn,
  };
  return { child, lines, custody, confirmProbeReleased, launch, options };
}
it("initializes fixed arguments, routes permissions, and cleans up without target commands", async () => {
  const f = fixture();
  const owner = await DebugProcess.start(f.options);
  expect(f.custody.prepareSpawn).toHaveBeenCalledOnce();
  expect(f.launch.mock.calls[0]).toEqual([
    f.options.executable,
    expect.arrayContaining(["-nx", "--interpreter=mi2"]),
    { cwd: project, shell: false, windowsHide: true, stdio: "pipe" },
  ]);
  const before = f.lines.length;
  await expect(
    owner.command("continue", { workspaceDir: project }),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(f.lines).toHaveLength(before);
  await owner.command("bt", { workspaceDir: project });
  expect(f.lines.at(-1)).toContain("-stack-list-frames");
  const commands = f.lines.length;
  await owner.cleanupProcess();
  expect(f.lines).toHaveLength(commands);
  expect(f.child.kill).toHaveBeenCalledWith("SIGTERM");
  expect(f.custody.releaseAfterExit).toHaveBeenCalledOnce();
  expect(owner.state()).toMatchObject({ closed: true, cleanupPending: false });
});
it("retains custody after direct exit until descendant release is proven", async () => {
  const f = fixture();
  f.confirmProbeReleased.mockResolvedValue(false);
  const owner = await DebugProcess.start(f.options);
  await expect(owner.cleanupProcess()).rejects.toMatchObject({
    code: "GDB_CLEANUP_PENDING",
  });
  expect(f.custody.releaseAfterExit).not.toHaveBeenCalled();
  expect(owner.state()).toMatchObject({ closed: true, cleanupPending: true });
  f.confirmProbeReleased.mockResolvedValue(true);
  await owner.cleanupProcess();
  await owner.cleanupProcess();
  expect(f.custody.releaseAfterExit).toHaveBeenCalledOnce();
});
it("cleans up unsupported initialization without loading symbols", async () => {
  const f = fixture(true);
  await expect(DebugProcess.start(f.options)).rejects.toMatchObject({
    code: "GDB_START_FAILED",
    context: { cleanupPending: false },
  });
  expect(f.lines).toHaveLength(1);
  expect(f.custody.releaseAfterExit).toHaveBeenCalledOnce();
});
it("releases custody if process creation throws before a child exists", async () => {
  const f = fixture();
  f.launch.mockImplementation(() => {
    throw new Error("spawn rejected");
  });
  await expect(DebugProcess.start(f.options)).rejects.toThrow("spawn rejected");
  expect(f.custody.releaseAfterExit).toHaveBeenCalledOnce();
});
it("keeps stderr bounded and separate from command completion", async () => {
  const f = fixture();
  const owner = await DebugProcess.start(f.options);
  f.child.stderr.write("x".repeat(40000) + "999^done\n");
  expect(owner.state().stderr.length).toBe(16384);
  expect(owner.state().closed).toBe(false);
  await owner.cleanupProcess();
});

it("does not release on successful kill requests without confirmed close", async () => {
  const f = fixture();
  const owner = await DebugProcess.start(f.options);
  f.child.kill.mockImplementation(() => true);
  vi.useFakeTimers();
  try {
    const outcome = owner.cleanupProcess().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2001);
    expect(await outcome).toMatchObject({ code: "GDB_CLEANUP_PENDING" });
    expect(f.child.kill.mock.calls.map((call) => call[0])).toEqual([
      "SIGTERM",
      "SIGKILL",
    ]);
    expect(f.custody.releaseAfterExit).not.toHaveBeenCalled();
    expect(owner.state()).toMatchObject({
      closed: false,
      cleanupPending: true,
    });
    f.child.emit("close", null);
    await owner.cleanupProcess();
    expect(f.custody.releaseAfterExit).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
