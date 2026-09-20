/** Per-case evidence must agree with aggregate test results. */
import { expect, test } from "vitest";
import { summarizeTestOutput } from "../src/core/analysis/test-report.js";
const fixture = () => ({
  testcase_nums: 3,
  failure_nums: 1,
  error_nums: 0,
  skipped_nums: 1,
  duration: 1.234,
  test_suites: [
    {
      env_name: "native",
      test_name: "test_math",
      status: "FAILED",
      duration: 1.234,
      test_cases: [
        { name: "add", status: "PASSED" },
        {
          name: "divide",
          status: "FAILED",
          exception: "zero divisor",
          source: { file: "test/test_math/main.cpp", line: 17 },
        },
        { name: "slow", status: "SKIPPED" },
      ],
    },
  ],
});

test("retains failure source, exception fallback and skipped cases", () => {
  const result = summarizeTestOutput(JSON.stringify(fixture()));
  expect(result).toMatchObject({
    total: 3,
    failed: 1,
    errored: 0,
    skipped: 1,
    duration_s: 1.23,
  });
  expect(result.suites[0].cases[1]).toMatchObject({
    name: "divide",
    message: "zero divisor",
    file: "test/test_math/main.cpp",
    line: 17,
  });
});

test("rejects false passing counters, unfinished cases and missing reports", () => {
  const wrong = fixture();
  wrong.failure_nums = 0;
  const unfinished = fixture();
  unfinished.test_suites[0].test_cases[0].status = "RUNNING";
  for (const output of [
    "",
    "{}",
    JSON.stringify(wrong),
    JSON.stringify(unfinished),
  ])
    expect(() => summarizeTestOutput(output)).toThrow();
});

test("accepts explicitly empty test runs without inventing executed cases", () => {
  expect(
    summarizeTestOutput(
      JSON.stringify({
        testcase_nums: 0,
        failure_nums: 0,
        error_nums: 0,
        skipped_nums: 0,
        duration: 0,
        test_suites: [],
      }),
    ),
  ).toMatchObject({ total: 0, suites: [] });
});
