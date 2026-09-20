/** Named telemetry extraction shares the terminable regex boundary. */
import { expect, it } from "vitest";
import { extractBoundedCaptures } from "../src/core/bounded-pattern.js";
it("extracts repeated named values and translates supported Python groups", async () => {
  expect(
    await extractBoundedCaptures(
      ["heap=123 heap=456"],
      "(?P<name>heap)=(?P<value>\\d+)",
      { pythonNamedGroups: true },
    ),
  ).toEqual([
    { line: 0, start: 0, end: 8, name: "heap", value: "123" },
    { line: 0, start: 9, end: 17, name: "heap", value: "456" },
  ]);
});
it("requires a value group even when no line matches", async () => {
  await expect(
    extractBoundedCaptures(["none"], "(?<name>heap)"),
  ).rejects.toMatchObject({ code: "PATTERN_INVALID" });
});
it("bounds output and terminates pathological patterns", async () => {
  await expect(
    extractBoundedCaptures(["x".repeat(129)], "(?<value>x+)"),
  ).rejects.toMatchObject({ code: "PATTERN_OUTPUT_LIMIT" });
  await expect(
    extractBoundedCaptures(["a".repeat(100000) + "!"], "(?<value>(a+)+)$", {
      timeoutMs: 20,
    }),
  ).rejects.toMatchObject({ code: "PATTERN_TIMEOUT" });
});
