/** Telemetry parsing must preserve unit uncertainty and reject unbounded data. */
import { expect, it } from "vitest";
import { parseMemoryTelemetry as parse } from "../src/core/memory-telemetry-parser.js";
it("extracts heap observations from a shared line", () => {
  expect(parse(["Free heap: 10000 min: 9000 largest: 4000"])).toMatchObject({
    recognized: true,
    samples: [
      { line: 0, metric: "free_heap", value: 10000, unit: "bytes" },
      { metric: "min_free_heap", value: 9000 },
      { metric: "largest_free_block", value: 4000 },
    ],
  });
});
it("does not label unspecified stack counts as bytes", () => {
  expect(parse(["loopTask: stack hwm 100"])).toMatchObject({
    unknownUnitSamples: 1,
    samples: [{ task: "loopTask", value: 100, unit: "unknown" }],
  });
  expect(
    parse(["loopTask: stack hwm 100 words"], { stackWordBytes: 4 }).samples[0],
  ).toMatchObject({ value: 400, unit: "bytes" });
  expect(
    parse(["loopTask: stack hwm 100 bytes"], {
      stackUnit: "words",
      stackWordBytes: 4,
    }).samples[0].value,
  ).toBe(100);
  expect(() => parse([], { stackUnit: "words" })).toThrow("stackWordBytes");
});
it("returns unrecognized for ordinary logs and enforces numeric and byte bounds", () => {
  expect(parse(["hello board"]).recognized).toBe(false);
  expect(() => parse(["Free heap: 9999999999999999999999"])).toThrow(
    "integer bounds",
  );
  expect(() => parse(["x".repeat(16385)])).toThrow("limits");
});

it("reads only aggregate ESP-IDF heap totals inside a recognized block", () => {
  const parsed = parse([
    "Heap summary for capabilities 0x00000004:",
    "at 0x3ffae6e0 len 6400 free 100 allocated 10 min_free 80 largest_free_block 90",
    "Totals:",
    "free 1000 allocated 500 min_free 900 largest_free_block 600",
  ]);
  expect(parsed.samples.map((sample) => sample.value)).toEqual([
    1000, 500, 900, 600,
  ]);
  expect(parse(["free 1000 allocated 500"]).recognized).toBe(false);
});
it("requires a task-table header and keeps unknown units explicit", () => {
  expect(parse(["loop R 1 128 2"]).recognized).toBe(false);
  const parsed = parse(
    [
      "Name State Prio Stack Num",
      "loop R 1 128 2",
      "idle B 0 256 3",
      "",
      "stray R 1 10 4",
    ],
    { stackUnit: "words", stackWordBytes: 4 },
  );
  expect(parsed.samples.map((sample) => [sample.task, sample.value])).toEqual([
    ["loop", 512],
    ["idle", 1024],
  ]);
});
it("does not truncate decimal values into integer measurements", () => {
  expect(parse(["Free heap: 1.5", "loopTask: stack hwm 2.5"]).recognized).toBe(
    false,
  );
});
