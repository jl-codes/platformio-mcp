/** Static analysis reports must retain severity/source evidence and fail closed on invalid output. */
import { expect, test } from "vitest";
import { summarizeCheckOutput } from "../src/core/analysis/check-report.js";

test("sorts defects and strips only real project ancestors", () => {
  const result = summarizeCheckOutput(
    JSON.stringify([
      {
        env: "native",
        tool: "cppcheck",
        succeeded: false,
        duration: 1.234,
        defects: [
          {
            severity: "low",
            file: "/work/project/src/a.cpp",
            line: 4,
            message: "style",
          },
          {
            severity: "high",
            file: "/work/project-other/a.cpp",
            line: 1,
            cwe: 120,
            message: "overflow",
          },
          { severity: "high", file: "/work/project/src/b.cpp", line: 3 },
        ],
      },
    ]),
    "/work/project",
  );
  expect(result).toMatchObject({
    defect_count: 3,
    by_severity: { high: 2, medium: 0, low: 1 },
    tools: [{ succeeded: false, duration_s: 1.23 }],
  });
  expect(result.defects.map((item) => item.file)).toEqual([
    "/work/project-other/a.cpp",
    "src/b.cpp",
    "src/a.cpp",
  ]);
  expect(result.defects[0].cwe).toBe(120);
});

test("rejects missing JSON and malformed success metadata", () => {
  for (const value of [
    "analysis failed",
    "[broken",
    '[{"succeeded":"false"}]',
    '[{"succeeded":true,"defects":{}}]',
  ])
    expect(() => summarizeCheckOutput(value, "/work")).toThrow();
});

test("counts unusual severity names without inherited-property pollution", () => {
  const result = summarizeCheckOutput(
    '[{"succeeded":true,"defects":[{"severity":"__proto__"}]}]',
    "/work",
  );
  expect(Object.getPrototypeOf(result.by_severity)).toBe(Object.prototype);
  expect(result.by_severity["__proto__"]).toBe(1);
});
