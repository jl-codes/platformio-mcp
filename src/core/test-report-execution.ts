/** Own a private foreground test report across execution, parsing and confirmed-process cleanup. */
import fs from "node:fs/promises";
import path from "node:path";
import { runTests, type TestExecutionOptions } from "../tools/build.js";
import type { BuildResult } from "../types.js";
import { SERVER_DATA_DIR } from "../utils/paths.js";
import { readCommandOutput } from "../utils/command-log.js";
import { PlatformIOError } from "../utils/errors.js";
import { summarizeTestOutput } from "./analysis/test-report.js";

/** Run through the existing test engine; callers retain authorization and hardware-lock ownership. */
export async function runTestsWithReport(
  projectDir: string,
  environment?: string,
  compileOnly?: boolean,
  options: Omit<TestExecutionOptions, "reportPath"> = {},
): Promise<BuildResult> {
  const parent = path.join(SERVER_DATA_DIR, "test-reports");
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(path.join(parent, "run-"));
  const reportPath = path.join(directory, "report.json");
  let retain = false;
  try {
    await fs.writeFile(reportPath, "", { flag: "wx", mode: 0o600 });
    const result = await runTests(projectDir, environment, false, compileOnly, {
      ...options,
      reportPath,
    });
    try {
      const stat = await fs.lstat(reportPath);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new PlatformIOError(
          "Test report is not a regular file",
          "TEST_REPORT_INVALID",
        );
      const testReport = summarizeTestOutput(
        await readCommandOutput(reportPath),
      );
      return {
        ...result,
        success:
          result.success === true &&
          testReport.failed === 0 &&
          testReport.errored === 0,
        testReport,
      };
    } catch (error) {
      if (
        error instanceof PlatformIOError ||
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        return {
          ...result,
          success: false,
          testReportError:
            error instanceof PlatformIOError
              ? (error.code ?? "TEST_REPORT_INVALID")
              : "TEST_REPORT_MISSING",
        };
      throw error;
    }
  } catch (error) {
    if (
      error instanceof PlatformIOError &&
      error.context?.cleanupPending === true
    ) {
      retain = true;
      throw new PlatformIOError(error.message, error.code, {
        ...error.context,
        retainedReportPath: reportPath,
      });
    }
    throw error;
  } finally {
    if (!retain) {
      // Remove only the owned file and empty directory; never recurse into command-created content.
      await fs.unlink(reportPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
      await fs.rmdir(directory);
    }
  }
}
