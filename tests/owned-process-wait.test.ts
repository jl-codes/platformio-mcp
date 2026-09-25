/** Termination requests must not free device custody until process exit is observed. */
import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { waitForOwnedProcess } from "../src/utils/owned-process-wait.js";
afterEach(() => vi.useRealTimers());
function child() {
  return Object.assign(new EventEmitter(), {
    pid: 42,
    exitCode: null as number | null,
    signalCode: null,
    kill: vi.fn(() => true),
  }) as unknown as ChildProcess;
}
it("does not settle when termination is merely requested", async () => {
  vi.useFakeTimers();
  const proc = child();
  const result = expect(
    waitForOwnedProcess(proc, 10, 20),
  ).rejects.toMatchObject({
    code: "COMMAND_TIMEOUT",
    context: { cleanupPending: false },
  });
  await vi.advanceTimersByTimeAsync(10);
  expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  proc.emit("exit", null, "SIGTERM");
  await result;
  await vi.advanceTimersByTimeAsync(100);
  expect(proc.kill).toHaveBeenCalledTimes(1);
  expect(proc.listenerCount("exit")).toBe(0);
});
it("retains ownership uncertainty if both termination requests lack exit evidence", async () => {
  vi.useFakeTimers();
  const proc = child();
  const result = expect(
    waitForOwnedProcess(proc, 10, 20),
  ).rejects.toMatchObject({
    code: "PROCESS_CLEANUP_PENDING",
    context: { cleanupPending: true },
  });
  await vi.advanceTimersByTimeAsync(50);
  await result;
  expect(proc.kill).toHaveBeenCalledTimes(2);
});
it("recognizes a child that exited before listeners were attached", async () => {
  const proc = child();
  proc.exitCode = 0;
  expect(await waitForOwnedProcess(proc, 100)).toBe(0);
  expect(proc.kill).not.toHaveBeenCalled();
});

it("confirms a real timed-out child exits before reporting cleanup complete", async () => {
  const proc = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    await expect(waitForOwnedProcess(proc, 100, 1000)).rejects.toMatchObject({
      code: "COMMAND_TIMEOUT",
      context: { cleanupPending: false },
    });
    expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true);
  } finally {
    if (proc.exitCode === null && proc.signalCode === null)
      proc.kill("SIGKILL");
  }
});

it.each([false, true])(
  "bounds cancellation with confirmed exit=%s",
  async (exits) => {
    vi.useFakeTimers();
    const proc = child();
    const controller = new AbortController();
    const result = expect(
      waitForOwnedProcess(proc, 600000, 20, controller.signal),
    ).rejects.toMatchObject({
      code: exits ? "PROCESS_CANCELLED" : "PROCESS_CLEANUP_PENDING",
      context: { cleanupPending: !exits },
    });
    controller.abort();
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    if (exits) proc.emit("exit", null, "SIGTERM");
    await vi.advanceTimersByTimeAsync(40);
    await result;
    expect(proc.kill).toHaveBeenCalledTimes(exits ? 1 : 2);
    expect(proc.listenerCount("exit")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);
