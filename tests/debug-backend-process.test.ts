/** Supervisor exit alone never proves descendant cleanup, while bounded operational failures can still clean up. */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import { expect, it, vi } from "vitest";
import type { spawn } from "node:child_process";
import { DebugBackendProcess } from "../src/core/debug/debug-backend-process.js";
function fixture() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 100,
  });
  const owner = new DebugBackendProcess({
    pythonExecutable: path.resolve("python.exe"),
    command: {
      executable: path.resolve("backend.exe"),
      cwd: path.resolve("."),
      arguments: [],
    },
    launch: vi.fn(() => child) as unknown as typeof spawn,
  });
  const event = (value: unknown) =>
    child.stdout.write(JSON.stringify(value) + "\n");
  return { child, owner, event };
}
it("requires confirmed group cleanup and supervisor closure", async () => {
  const { child, owner, event } = fixture();
  event({ event: "started", pid: 101 });
  await owner.waitStarted();
  const cleanup = owner.cleanupProcess();
  expect(owner.cleanupProcess()).toBe(cleanup);
  event({ event: "stopped", cleanupConfirmed: true });
  expect(owner.state().cleanupPending).toBe(true);
  child.emit("close", 0);
  await cleanup;
  expect(owner.state().cleanupPending).toBe(false);
});
it("retains cleanup ownership after supervisor dies without proof", async () => {
  const { child, owner, event } = fixture();
  event({ event: "started", pid: 101 });
  await owner.waitStarted();
  child.emit("close", 1);
  await expect(owner.cleanupProcess()).rejects.toMatchObject({
    code: "DEBUG_BACKEND_CLEANUP_PENDING",
  });
});
it("allows cleanup after an output limit failure when a valid empty-group proof follows", async () => {
  const { child, owner, event } = fixture();
  event({ event: "started", pid: 101 });
  await owner.waitStarted();
  child.stderr.write(Buffer.alloc(1024 * 1024 + 1, 65));
  expect(owner.state()).toMatchObject({ failed: true, cleanupPending: true });
  expect(Buffer.byteLength(owner.state().outputTail)).toBeLessThanOrEqual(
    16384,
  );
  event({ event: "stopped", cleanupConfirmed: true });
  child.emit("close", 0);
  await owner.cleanupProcess();
});
it("rejects contradictory control records even after an earlier cleanup claim", async () => {
  const { child, owner, event } = fixture();
  event({ event: "started", pid: 101 });
  event({ event: "stopped", cleanupConfirmed: true });
  event({ event: "started", pid: 102 });
  child.emit("close", 0);
  await expect(owner.cleanupProcess()).rejects.toMatchObject({
    code: "DEBUG_BACKEND_CLEANUP_PENDING",
  });
});
it("pre-launch supervisor failures can prove that no backend was created", async () => {
  const { child, owner, event } = fixture();
  event({ event: "failed", cleanupConfirmed: true, errorType: "OSError" });
  child.emit("close", 1);
  await expect(owner.waitStarted()).rejects.toMatchObject({
    code: "DEBUG_BACKEND_START_FAILED",
  });
  await owner.cleanupProcess();
});
