/** Report lifetime follows process custody; invalid reports cannot imply a passing test run. */
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../src/tools/build.js", () => ({ runTests: mocks.run }));
import { runTestsWithReport } from "../src/core/test-report-execution.js";
import { PlatformIOError } from "../src/utils/errors.js";

const empty = {
  testcase_nums: 0,
  failure_nums: 0,
  error_nums: 0,
  skipped_nums: 0,
  duration: 0,
  test_suites: [],
};

test("completed reports are parsed and their owned files removed", async () => {
  let reportPath = "";
  mocks.run.mockImplementationOnce(
    async (_project, _env, background, _compile, options) => {
      expect(background).toBe(false);
      reportPath = options.reportPath;
      await fs.writeFile(reportPath, JSON.stringify(empty));
      return { success: true };
    },
  );
  await expect(runTestsWithReport("workspace")).resolves.toMatchObject({
    success: true,
    testReport: { total: 0 },
  });
  await expect(fs.stat(reportPath)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(fs.stat(path.dirname(reportPath))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

test("missing report overrides a successful command exit", async () => {
  mocks.run.mockResolvedValueOnce({ success: true });
  await expect(runTestsWithReport("workspace")).resolves.toMatchObject({
    success: false,
    testReportError: "TEST_REPORT_INVALID",
  });
});

test("unconfirmed termination retains the report destination and custody error", async () => {
  mocks.run.mockRejectedValueOnce(
    new PlatformIOError("pending", "PROCESS_CLEANUP_PENDING", {
      cleanupPending: true,
    }),
  );
  let retained = "";
  try {
    await runTestsWithReport("workspace");
    throw new Error("expected custody failure");
  } catch (error) {
    expect(error).toMatchObject({
      code: "PROCESS_CLEANUP_PENDING",
      context: { cleanupPending: true },
    });
    retained = String((error as PlatformIOError).context?.retainedReportPath);
  }
  try {
    expect((await fs.stat(retained)).isFile()).toBe(true);
  } finally {
    await fs.unlink(retained);
    await fs.rmdir(path.dirname(retained));
  }
});
