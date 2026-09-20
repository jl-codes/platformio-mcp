/** Validate PlatformIO test reports and retain per-case failures without inventing passing totals. */
import { z } from "zod";
import { PlatformIOError } from "../../utils/errors.js";

const text = z.string().max(65536).nullable().optional();
const count = z.number().int().nonnegative().max(1000000);
const duration = z.number().finite().nonnegative();
const testCase = z.object({
  name: text,
  status: z.enum(["PASSED", "FAILED", "ERRORED", "SKIPPED"]),
  message: text,
  exception: text,
  source: z
    .object({
      file: text,
      line: z.number().int().nonnegative().nullable().optional(),
    })
    .nullable()
    .optional(),
});
const reportSchema = z.object({
  testcase_nums: count,
  failure_nums: count,
  error_nums: count,
  skipped_nums: count,
  duration,
  test_suites: z
    .array(
      z.object({
        env_name: text,
        test_name: text,
        status: z.string().min(1).max(64),
        duration: duration.default(0),
        test_cases: z.array(testCase).max(100000),
      }),
    )
    .max(1024),
});

/** Project a bounded complete JSON report, rejecting contradictory counters or unfinished cases. */
export function summarizeTestOutput(output: string) {
  if (Buffer.byteLength(output) > 16 * 1024 * 1024)
    throw new PlatformIOError(
      "Test report exceeds 16 MiB",
      "TEST_REPORT_LIMIT",
    );
  let raw: unknown;
  try {
    raw = JSON.parse(output);
  } catch {
    throw new PlatformIOError(
      "Test runner returned no valid JSON report",
      "TEST_REPORT_INVALID",
    );
  }
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success)
    throw new PlatformIOError(
      "Test report has an invalid or incomplete shape",
      "TEST_REPORT_INVALID",
    );
  const report = parsed.data;
  if (
    report.failure_nums + report.error_nums + report.skipped_nums >
    report.testcase_nums
  )
    throw new PlatformIOError(
      "Test report counters contradict the total",
      "TEST_REPORT_INVALID",
    );
  const observed = { PASSED: 0, FAILED: 0, ERRORED: 0, SKIPPED: 0 };
  const suites = report.test_suites.map((suite) => ({
    env: suite.env_name ?? null,
    test: suite.test_name ?? null,
    status: suite.status,
    duration_s: Math.round(suite.duration * 100) / 100,
    cases: suite.test_cases.map((item) => {
      observed[item.status]++;
      return {
        name: item.name ?? null,
        status: item.status,
        message: item.message || item.exception || null,
        file: item.source?.file ?? null,
        line: item.source?.line ?? null,
      };
    }),
  }));
  const observedTotal = Object.values(observed).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (
    observedTotal !== report.testcase_nums ||
    observed.FAILED !== report.failure_nums ||
    observed.ERRORED !== report.error_nums ||
    observed.SKIPPED !== report.skipped_nums
  )
    throw new PlatformIOError(
      "Test case statuses contradict the report counters",
      "TEST_REPORT_INVALID",
    );
  return {
    total: report.testcase_nums,
    failed: report.failure_nums,
    errored: report.error_nums,
    skipped: report.skipped_nums,
    duration_s: Math.round(report.duration * 100) / 100,
    suites,
  };
}
