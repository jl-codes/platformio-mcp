/** Serial meter parsing preserves units, one-reading-per-line and bounded custom capture semantics. */
import { expect, it } from "vitest";
import { parsePowerLines } from "../src/core/power/power-parser.js";
it("normalizes supported current and voltage units without counting voltage as current", async () => {
  expect(
    await parsePowerLines([
      "current 500uA 3.3V",
      "-2 mA 3300mV",
      "0.01 A",
      "750µA",
      "12",
      "ready",
      " ",
    ]),
  ).toEqual({
    samples: [
      { line: 0, currentMa: 0.5, voltageMv: 3300 },
      { line: 1, currentMa: -2, voltageMv: 3300 },
      { line: 2, currentMa: 10, voltageMv: null },
      { line: 3, currentMa: 0.75, voltageMv: null },
      { line: 4, currentMa: 12, voltageMv: null },
    ],
    unparsedLines: 1,
  });
});
it("supports explicit named current/voltage groups with reference default units", async () => {
  expect(
    (
      await parsePowerLines(
        ["I=1.25,U=3.3"],
        String.raw`I=(?P<value>[\d.]+),U=(?P<voltage>[\d.]+)`,
      )
    ).samples,
  ).toEqual([{ line: 0, currentMa: 1.25, voltageMv: 3300 }]);
});
it("rejects unknown units, nonnumeric captures and excessive numeric values", async () => {
  await expect(
    parsePowerLines(["1 kA"], String.raw`(?P<value>\d+) (?P<unit>\w+)`),
  ).rejects.toMatchObject({ code: "POWER_UNIT_INVALID" });
  await expect(
    parsePowerLines(["bad"], String.raw`(?P<value>\w+)`),
  ).rejects.toMatchObject({ code: "POWER_VALUE_INVALID" });
  await expect(
    parsePowerLines(["1e309"], String.raw`(?P<value>.+)`),
  ).rejects.toMatchObject({ code: "POWER_VALUE_INVALID" });
});
it("keeps the first reading and refuses missing named-value patterns", async () => {
  expect((await parsePowerLines(["1 mA 2 mA"])).samples).toEqual([
    { line: 0, currentMa: 1, voltageMv: null },
  ]);
  await expect(parsePowerLines(["1"], "(\\d+)")).rejects.toMatchObject({
    code: "PATTERN_INVALID",
  });
});
