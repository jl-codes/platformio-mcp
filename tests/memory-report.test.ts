/** Memory reports preserve sample pairing, timestamp scope and unknown unit evidence. */
import { expect, it } from "vitest";
import { analyzeMemoryTelemetry as report } from "../src/core/memory-report.js";
it("aggregates heap trends and paired fragmentation without inventing timestamps", () => {
  const result = report([
    "Free heap: 10000 min: 9000 largest: 4000",
    "Free heap: 9000 min: 8000 largest: 3000",
    "Free heap: 8000 min: 7000 largest: 2000",
  ]);
  expect(result.metrics.free_heap).toMatchObject({
    verdict: "shrinking",
    bytesPerSecond: null,
  });
  expect(result.fragmentation).toMatchObject({
    line: 2,
    ratio: 0.25,
    fragmented: true,
  });
});
it("retains unknown stack counts without comparing them to byte thresholds", () => {
  const result = report([
    "loopTask: stack hwm 100",
    "known: stack hwm 100 bytes",
  ]);
  expect(result.stacks.find((task) => task.task === "loopTask")).toMatchObject({
    stackFreeBytes: null,
    warning: null,
    unknownUnitSamples: 1,
  });
  expect(result.stacks.find((task) => task.task === "known")).toMatchObject({
    stackFreeBytes: 100,
    warning: true,
  });
});
it("bounds sample output while analyzing all supplied observations", () => {
  const result = report(Array.from({ length: 250 }, () => "Free heap: 1000"));
  expect(result.samples).toHaveLength(200);
  expect(result.sampleCount).toBe(250);
  expect(result.metrics.free_heap.samples).toBe(250);
  expect(result.samplesTruncated).toBe(true);
});
it("validates line timestamps and returns explicit unrecognized telemetry", () => {
  expect(() => report(["Free heap: 1000"], { elapsedSeconds: [] })).toThrow(
    "every input line",
  );
  expect(report(["hello board"]).recognized).toBe(false);
  expect(report(["hello board"]).fragmentation).toBeNull();
});
