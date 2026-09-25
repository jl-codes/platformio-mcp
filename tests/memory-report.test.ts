/** Memory reports preserve sample pairing, timestamp scope and unknown unit evidence. */
import { expect, it } from "vitest";
import {
  analyzeMemoryTelemetry as report,
  analyzeMemoryTelemetryPattern,
} from "../src/core/memory-report.js";
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

it("merges custom named byte metrics with built-in telemetry", async () => {
  const result = await analyzeMemoryTelemetryPattern(
    ["Free heap: 1000", "mem=200", "mem=300"],
    "mem=(?P<value>\\d+)",
  );
  expect(result.metrics.free_heap.last).toBe(1000);
  expect(result.metrics.custom).toMatchObject({
    samples: 2,
    first: 200,
    last: 300,
  });
  expect(result.formats).toContain("custom");
});
it("does not double count a custom metric overriding the same line and name", async () => {
  const result = await analyzeMemoryTelemetryPattern(
    ["Free heap: 1000"],
    "(?P<name>Free heap): (?P<value>\\d+)",
  );
  expect(result.metrics.free_heap.samples).toBe(1);
});
it("rejects custom values that would otherwise be coerced or rounded", async () => {
  await expect(
    analyzeMemoryTelemetryPattern(["mem=1.5"], "mem=(?P<value>.+)"),
  ).rejects.toMatchObject({ code: "MEMORY_VALUE_INVALID" });
});

it("converts explicit custom units and requires word-size evidence", async () => {
  const pattern = "mem=(?P<value>\\d+) (?P<unit>\\w+)";
  expect(
    (await analyzeMemoryTelemetryPattern(["mem=2 KiB"], pattern)).metrics.custom
      .last,
  ).toBe(2048);
  expect(
    (
      await analyzeMemoryTelemetryPattern(["mem=2 words"], pattern, {
        stackWordBytes: 4,
      })
    ).metrics.custom.last,
  ).toBe(8);
  await expect(
    analyzeMemoryTelemetryPattern(["mem=2 words"], pattern),
  ).rejects.toMatchObject({ code: "MEMORY_UNIT_REQUIRED" });
  await expect(
    analyzeMemoryTelemetryPattern(["mem=2 bananas"], pattern),
  ).rejects.toMatchObject({ code: "MEMORY_UNIT_REQUIRED" });
});

it("custom spans replace overlapping labels but preserve separate same-line measurements", async () => {
  const report = await analyzeMemoryTelemetryPattern(
    ["Free heap: 1000; Free heap: 2000"],
    "Free heap: (?P<value>1000)",
  );
  expect(report.metrics.custom.last).toBe(1000);
  expect(report.metrics.free_heap).toMatchObject({ samples: 1, last: 2000 });
});

it("uses the same coordinates for colored custom and built-in measurements", async () => {
  const report = await analyzeMemoryTelemetryPattern(
    ["\x1b[32mFree heap: 1000\x1b[0m; Free heap: 2000"],
    "Free heap: (?P<value>1000)",
  );
  expect(report.metrics.free_heap).toMatchObject({ samples: 1, last: 2000 });
});
