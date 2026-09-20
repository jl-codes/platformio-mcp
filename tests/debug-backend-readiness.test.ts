/** Readiness evidence cannot mask process failure, cancellation, expired time, or policy revocation. */
import { expect, it } from "vitest";
import {
  validateBackendReadyPattern,
  waitForBackendReady,
} from "../src/core/debug/debug-backend-readiness.js";
function state(outputTail = "") {
  return {
    pid: 123,
    started: true,
    closed: false,
    failed: false,
    cleanupPending: true,
    outputTail,
  };
}
it("recognizes backend output after split chunks have been assembled", async () => {
  let output = "Listening on port 33";
  const timer = setTimeout(() => {
    output += "33 for gdb connections";
  }, 20);
  try {
    await waitForBackendReady(
      { state: () => state(output) },
      "Listening on port 3333 for gdb connections",
      { timeoutMs: 2000, guard() {} },
    );
  } finally {
    clearTimeout(timer);
  }
});
it("rejects patterns that could declare readiness without evidence", async () => {
  for (const pattern of ["", " ", "a*", "^$"])
    await expect(validateBackendReadyPattern(pattern)).rejects.toMatchObject({
      code: "DEBUG_READY_PATTERN_INVALID",
    });
});
it("a matching message from an exited process is not readiness", async () => {
  await expect(
    waitForBackendReady(
      { state: () => ({ ...state("ready"), closed: true }) },
      "ready",
      { timeoutMs: 1000, guard() {} },
    ),
  ).rejects.toMatchObject({ code: "DEBUG_BACKEND_NOT_READY" });
});
it("rechecks process state after the worker evaluates matching output", async () => {
  let reads = 0;
  await expect(
    waitForBackendReady(
      { state: () => ({ ...state("ready"), failed: ++reads >= 3 }) },
      "ready",
      { timeoutMs: 1000, guard() {} },
    ),
  ).rejects.toMatchObject({ code: "DEBUG_BACKEND_NOT_READY" });
});
it("revoked authorization prevents readiness disclosure", async () => {
  let checks = 0;
  await expect(
    waitForBackendReady({ state: () => state("ready") }, "ready", {
      timeoutMs: 1000,
      guard() {
        if (++checks > 1) throw new Error("revoked");
      },
    }),
  ).rejects.toThrow("revoked");
});
it("honors cancellation without accepting a matching line", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    waitForBackendReady({ state: () => state("ready") }, "ready", {
      timeoutMs: 1000,
      signal: controller.signal,
      guard() {},
    }),
  ).rejects.toMatchObject({ code: "DEBUG_CANCELLED" });
});
it("times out rather than treating process creation as readiness", async () => {
  await expect(
    waitForBackendReady({ state: () => state() }, "ready", {
      timeoutMs: 100,
      guard() {},
    }),
  ).rejects.toMatchObject({ code: "DEBUG_BACKEND_READY_TIMEOUT" });
});
