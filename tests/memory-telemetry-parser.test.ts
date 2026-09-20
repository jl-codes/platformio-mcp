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
