/** Worker handshake deadlines with a simulated worker; real regex termination is tested separately. */
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ workers: [] as any[] }));
vi.mock("node:worker_threads", () => ({
  Worker: class extends EventEmitter {
    postMessage = vi.fn();
    terminate = vi.fn(async () => 0);
    constructor() {
      super();
      state.workers.push(this);
    }
  },
}));
import { matchBoundedLines } from "../src/core/bounded-pattern.js";
afterEach(() => {
  vi.useRealTimers();
  state.workers.length = 0;
});
describe("regex worker deadlines", () => {
  it("does not spend the regex execution budget during a slow worker startup", async () => {
    vi.useFakeTimers();
    const result = matchBoundedLines(["ok"], "ok", {
      mode: "regex",
      timeoutMs: 100,
    });
    const worker = state.workers[0];
    await vi.advanceTimersByTimeAsync(4500);
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.emit("message", { ready: true });
    expect(worker.postMessage).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(99);
    worker.emit("message", { indices: [0] });
    await expect(result).resolves.toEqual([0]);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("bounds startup and ignores readiness received after termination", async () => {
    vi.useFakeTimers();
    const result = matchBoundedLines(["ok"], "ok", { mode: "regex" });
    const rejected = expect(result).rejects.toMatchObject({
      code: "PATTERN_WORKER_STARTUP_TIMEOUT",
    });
    const worker = state.workers[0];
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    worker.emit("message", { ready: true });
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
