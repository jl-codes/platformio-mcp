/** Reference test arguments and per-case reports through the canonical high-risk test operation. */
import { z } from "zod";
import type { BuildResult } from "../types.js";
import { runTestsWithReport } from "../core/test-report-execution.js";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { hardwareLockManager } from "../utils/lock-manager.js";
import { readCommandOutput, retainCommandLog } from "../utils/command-log.js";
import { PlatformIOError } from "../utils/errors.js";
import { cleanCompatibilityResult } from "./clean-compat.js";
import {
  resolveCompatibilityProject,
  type CompatibilityProjectDefaults,
} from "./compatibility-project.js";

/** Authorize exact stage/filter selections; build-only restrictions remain in the shared test executor. */
export async function executeTestCompatibility(
  input: unknown,
  defaults: CompatibilityProjectDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const text = z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^\x00-\x1f\x7f]+$/);
  const params = z
    .object({
      project_dir: z.string().max(32768).nullable().optional(),
      env: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,50}$/)
        .nullable()
        .optional(),
      filter: text.nullable().optional(),
      ignore: text.nullable().optional(),
      without_uploading: z.boolean().default(false),
      without_building: z.boolean().default(false),
      upload_port: text.nullable().optional(),
      verbose: z.boolean().default(false),
      approval_id: z.string().max(256).optional(),
    })
    .strict()
    .parse(input);
  const projectDir = await resolveCompatibilityProject(
    params.project_dir,
    defaults,
  );
  const environment = params.env ?? undefined;
  const options = {
    filter: params.filter ?? undefined,
    ignore: params.ignore ?? undefined,
    withoutUploading: params.without_uploading,
    withoutBuilding: params.without_building,
    uploadPort: params.upload_port ?? undefined,
    verbose: params.verbose,
  };
  return dispatchAuthorizedAction(
    "run_tests",
    { projectDir, environment, ...options, approvalId: params.approval_id },
    { ...caller, workspaceDir: projectDir },
    async () => {
      const guard = createPolicyRevisionGuard(projectDir);
      await onAuthorized?.();
      guard();
      return hardwareLockManager.withImplicitLock(async () => {
        guard();
        let captured:
          | { exitCode: number; output: string; logPath: string }
          | undefined;
        let result: BuildResult;
        try {
          result = await runTestsWithReport(
            projectDir,
            environment,
            undefined,
            {
              ...options,
              timeoutMs: 1200000,
              onResult: async (execution) => {
                guard();
                const output = await readCommandOutput(execution.fullLogPath);
                guard();
                captured = {
                  exitCode: execution.exitCode,
                  output,
                  logPath: await retainCommandLog("test", output, ""),
                };
              },
            },
          );
        } catch (error) {
          if (
            !(error instanceof PlatformIOError) ||
            error.code !== "COMMAND_TIMEOUT" ||
            error.context?.cleanupPending !== false ||
            typeof error.context.fullLogPath !== "string"
          )
            throw error;
          guard();
          const output =
            (await readCommandOutput(error.context.fullLogPath)) +
            "\n[platformio-mcp] timed out after 1200s";
          guard();
          const logPath = await retainCommandLog("test", output, "");
          const diagnostics = cleanCompatibilityResult(
            { exitCode: -1, output, logPath },
            environment,
            1200,
            true,
          );
          guard();
          return {
            ok: false,
            status: "error",
            error: "test_timeout",
            summary:
              "pio test timed out after 1200s; no complete test report is available.",
            build_errors: diagnostics.errors,
            exit_code: -1,
            output_tail: diagnostics.output_tail,
            log_path: logPath,
          };
        }
        guard();
        if (!captured)
          throw new PlatformIOError(
            "Test output was not collected",
            "COMPAT_RESULT_INVALID",
          );
        const diagnostics = cleanCompatibilityResult(captured, environment, 0);
        const report = result.testReport;
        if (!report)
          return {
            ok: false,
            status: "error",
            summary: `pio test produced no valid report (exit ${captured.exitCode}). See output_tail.`,
            report_error: result.testReportError ?? "TEST_REPORT_MISSING",
            build_errors: diagnostics.errors,
            output_tail: diagnostics.output_tail,
            log_path: captured.logPath,
          };
        const failedCases = report.suites
          .flatMap((suite) => suite.cases)
          .filter(
            (item) => item.status === "FAILED" || item.status === "ERRORED",
          );
        const ok = result.success === true && !report.failed && !report.errored;
        const passed =
          report.total -
          report.failed -
          report.errored -
          report.skipped -
          report.warned;
        let summary = `${report.total} test case(s): ${passed} passed, ${report.failed} failed, ${report.errored} errored, ${report.skipped} skipped${report.warned ? `, ${report.warned} warned` : ""} in ${report.duration_s}s.`;
        if (failedCases.length) {
          const first = failedCases[0];
          summary +=
            ` First failure: ${first.name}` +
            (first.file ? ` at ${first.file}:${first.line}` : "") +
            (first.message ? `: ${first.message}` : "");
        }
        if (diagnostics.error_count)
          summary += ` ${diagnostics.error_count} build error(s) in output.`;
        return {
          ok,
          status: ok ? "passed" : "failed",
          summary,
          ...report,
          build_errors: diagnostics.errors.slice(0, 20),
          exit_code: captured.exitCode,
          log_path: captured.logPath,
          output_tail: diagnostics.output_tail
            .split("\n")
            .slice(-30)
            .join("\n"),
        };
      });
    },
  );
}
