/** Memory trends must not invent timing, byte units, or conclusive leak evidence. */
import { expect, it } from "vitest";
import {
  memoryMetricStatistics as stats,
  memoryFragmentation,
} from "../src/core/memory-telemetry.js";
it("reports sample trends and refuses a time rate without timestamps", () => {
  expect(
    stats(
      "free_heap",
      [10000, 9000, 8000].map((value) => ({ value })),
    ),
  ).toMatchObject({
    verdict: "shrinking",
    fittedChange: -2000,
    bytesPerSecond: null,
    leakSuspected: true,
    evidence: "window_trend_only",
  });
  expect(stats("free_heap", [{ value: 10000 }, { value: 0 }])).toMatchObject({
    verdict: "insufficient_samples",
    leakSuspected: false,
  });
});
it("fits actual irregular sample times rather than assuming session uptime", () => {
  expect(
    stats("allocated", [
      { value: 1000, elapsedSeconds: 10 },
      { value: 1200, elapsedSeconds: 12 },
      { value: 2000, elapsedSeconds: 20 },
    ]).bytesPerSecond,
  ).toBeCloseTo(100);
  expect(
    stats("allocated", [
      { value: 1, elapsedSeconds: 10 },
      { value: 2, elapsedSeconds: 10 },
    ]).bytesPerSecond,
  ).toBeNull();
});
it("uses both absolute and relative thresholds and bounds samples", () => {
  expect(
    stats(
      "free_heap",
      [10000, 9990, 9980].map((value) => ({ value })),
    ).verdict,
  ).toBe("stable");
  expect(() => stats("free_heap", [{ value: -1 }])).toThrow();
  expect(() =>
    stats(
      "free_heap",
      Array.from({ length: 10001 }, () => ({ value: 1 })),
    ),
  ).toThrow();
});
it("rejects physically inconsistent fragmentation pairs", () => {
  expect(memoryFragmentation(1000, 200)).toMatchObject({
    available: true,
    fragmented: true,
    ratio: 0.2,
  });
  expect(memoryFragmentation(100, 200).available).toBe(false);
  expect(memoryFragmentation(0, 0).available).toBe(false);
});
