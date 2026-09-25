/** Authorize reference builds and cleanup through canonical actions and the shared execution lock. */
import { z } from "zod";
import type { SpoolingForegroundResult } from "../utils/spooler.js";
import { summarizeCheckOutput } from "../core/analysis/check-report.js";
import { buildProject, cleanProject, checkProject } from "../tools/build.js";
import { BuildError, PlatformIOError } from "../utils/errors.js";
import { hardwareLockManager } from "../utils/lock-manager.js";
import { retainCommandLog, readCommandOutput } from "../utils/command-log.js";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import {
  resolveCompatibilityProject,
  type CompatibilityProjectDefaults,
} from "./compatibility-project.js";

/** Execute selected clean target only after the exact request is authorized. */
export function executeCleanCompatibility(
  input: unknown,
  defaults: CompatibilityProjectDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  return executeRunCompatibility(
    "clean",
    input,
    defaults,
    caller,
    onAuthorized,
  );
}

/** Execute a fresh reference build through canonical authorization and the existing build engine. */
export function executeBuildCompatibility(
  input: unknown,
  defaults: CompatibilityProjectDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  return executeRunCompatibility(
    "build",
    input,
    defaults,
    caller,
    onAuthorized,
  );
}

/** Run structured static analysis under the canonical checker permission. */
export function executeCheckCompatibility(
  input: unknown,
  defaults: CompatibilityProjectDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  return executeRunCompatibility(
    "check",
    input,
    defaults,
    caller,
    onAuthorized,
  );
}

/** Shared result collection never replaces canonical build or cleanup execution. */
async function executeRunCompatibility(
  mode: "build" | "clean" | "check",
  input: unknown,
  defaults: CompatibilityProjectDefaults,
  caller: PolicyEvaluationContext,
  onAuthorized?: () => Promise<void>,
) {
  const scope = {
    project_dir: z.string().max(32768).nullable().optional(),
    env: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,50}$/)
      .nullable()
      .optional(),
    approval_id: z.string().max(256).optional(),
  };
  const params =
    mode === "clean"
      ? z
          .object({ ...scope, full: z.boolean().default(false) })
          .strict()
          .parse(input)
      : mode === "check"
        ? z
            .object({
              ...scope,
              severity: z.enum(["low", "medium", "high"]).default("medium"),
              pattern: z
                .string()
                .min(1)
                .max(4096)
                .regex(/^[^\x00-\x1f\x7f]+$/)
                .nullable()
                .optional(),
              skip_packages: z.boolean().default(true),
              tool: z
                .string()
                .min(1)
                .max(4096)
                .regex(/^[^\x00-\x1f\x7f]+$/)
                .nullable()
                .optional(),
            })
            .strict()
            .parse(input)
        : z
            .object({
              ...scope,
              jobs: z.number().int().min(1).max(1024).nullable().optional(),
              verbose: z.boolean().default(false),
            })
            .strict()
            .parse(input);
  const timeoutMs = mode === "clean" ? 120000 : 1200000;
  const projectDir = await resolveCompatibilityProject(
    params.project_dir,
    defaults,
  );
  const environment = params.env ?? undefined;
  return dispatchAuthorizedAction(
    mode === "build"
      ? "build_project"
      : mode === "check"
        ? "check_project"
        : "clean_project",
    {
      projectDir,
      environment,
      ...("full" in params
        ? { full: params.full }
        : "severity" in params
          ? {
              severity: params.severity,
              pattern: params.pattern ?? undefined,
              skipPackages: params.skip_packages,
              tool: params.tool ?? undefined,
              jsonOutput: true,
            }
          : { jobs: params.jobs ?? undefined, verbose: params.verbose }),
      approvalId: params.approval_id,
    },
    { ...caller, workspaceDir: projectDir },
    async () => {
      const guard = createPolicyRevisionGuard(projectDir);
      await onAuthorized?.();
      guard();
      return hardwareLockManager.withImplicitLock(async () => {
        guard();
        const started = performance.now();
        let completed:
          | { exitCode: number; output: string; logPath: string }
          | undefined;
        const collect = async (
          exitCode: number,
          fullLogPath: string,
          timedOut = false,
        ) => {
          guard();
          let output = await readCommandOutput(fullLogPath);
          guard();
          if (timedOut)
            output += `\n[platformio-mcp] timed out after ${timeoutMs / 1000}s`;
          const logPath = await retainCommandLog(mode, output, "");
          return { exitCode, output, logPath };
        };
        let timedOut = false;
        try {
          const onResult = async (result: SpoolingForegroundResult) => {
            completed = await collect(result.exitCode, result.fullLogPath);
          };
          if ("full" in params) {
            await cleanProject(projectDir, false, {
              environment,
              full: params.full,
              timeoutMs,
              onResult,
            });
          } else if ("severity" in params) {
            await checkProject(projectDir, environment, false, {
              severity: params.severity,
              pattern: params.pattern ?? undefined,
              skipPackages: params.skip_packages,
              tool: params.tool ?? undefined,
              jsonOutput: true,
              timeoutMs,
              onResult,
            });
          } else {
            await buildProject(projectDir, environment, params.verbose, false, {
              jobs: params.jobs ?? undefined,
              forceExecution: true,
              timeoutMs,
              onResult,
            });
          }
        } catch (error) {
          if (
            error instanceof PlatformIOError &&
            error.code === "COMMAND_TIMEOUT" &&
            error.context?.cleanupPending === false &&
            typeof error.context.fullLogPath === "string"
          ) {
            timedOut = true;
            completed = await collect(-1, error.context.fullLogPath, true);
          } else if (
            !(error instanceof BuildError) ||
            !completed ||
            error.context?.exitCode !== completed.exitCode
          )
            throw error;
        }
        guard();
        if (!completed)
          throw new PlatformIOError(
            "Command result was not collected",
            "COMPAT_RESULT_INVALID",
          );
        if ("severity" in params)
          return checkCompatibilityResult(
            completed,
            projectDir,
            params.severity,
            timedOut,
          );
        return cleanCompatibilityResult(
          completed,
          environment,
          (performance.now() - started) / 1000,
          timedOut,
          mode === "build" ? "build" : "clean",
        );
      });
    },
  );
}

/** Project completed output without treating a successful process as proof of successful build steps. */
export function cleanCompatibilityResult(
  result: { exitCode: number; output: string; logPath: string },
  environment: string | undefined,
  duration: number,
  timedOut = false,
  tool: string = "clean",
) {
  const output = normalizeCleanOutput(result.output);
  const lines = output.split("\n");
  const diagnostics: {
    kind: string;
    file: string;
    line: number;
    column: number | null;
    message: string;
  }[] = [];
  const seen = new Set<string>();
  const linkerDiagnostics: typeof diagnostics = [];
  const stepDiagnostics: typeof diagnostics = [];
  const environments: string[] = [];
  const memory: Record<
    string,
    { percent: number; used_bytes: number; total_bytes: number }
  > = {};
  let failed = false;
  for (const line of lines) {
    const env = /^Processing (\S+) \(/.exec(line);
    if (env) environments.push(env[1]);
    if (/^=+ \[(FAILED|ERROR)\] Took /.test(line)) failed = true;
    const mem =
      /^(RAM|Flash):\s+\[[=\s]*\]\s+([\d.]+)%\s+\(used (\d+) bytes from (\d+) bytes\)/.exec(
        line,
      );
    if (mem)
      memory[mem[1].toLowerCase()] = {
        percent: Number(mem[2]),
        used_bytes: Number(mem[3]),
        total_bytes: Number(mem[4]),
      };
    const compiler =
      /^(.+?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):\s*(.*)$/.exec(
        line,
      );
    const linker =
      /(undefined reference to .*|symbol\(s\) not found.*|multiple definition of .*|region .* overflowed by .*)$/.exec(
        line,
      );
    const step = /^\*\*\* \[([^\]]+)\] (.*)$/.exec(line);
    const candidates = [
      compiler
        ? {
            bucket: diagnostics,
            key: JSON.stringify(["compiler", ...compiler.slice(1)]),
            value: {
              kind: compiler[4].replace("fatal ", ""),
              file: compiler[1],
              line: Number(compiler[2]),
              column: compiler[3] ? Number(compiler[3]) : null,
              message: compiler[5].trim(),
            },
          }
        : null,
      linker
        ? {
            bucket: linkerDiagnostics,
            key: JSON.stringify(["linker", linker[1].trim()]),
            value: {
              kind: "error",
              file: "<linker>",
              line: 0,
              column: null,
              message: linker[1].trim(),
            },
          }
        : null,
      step
        ? {
            bucket: stepDiagnostics,
            key: JSON.stringify(["scons", step[1], step[2]]),
            value: {
              kind: "error",
              file: step[1],
              line: 0,
              column: null,
              message: `build step failed: ${step[2]}`,
            },
          }
        : null,
    ];
    for (const candidate of candidates) {
      if (candidate && !seen.has(candidate.key)) {
        seen.add(candidate.key);
        candidate.bucket.push(candidate.value);
      }
    }
  }
  diagnostics.push(...linkerDiagnostics, ...stepDiagnostics);
  const errors = diagnostics.filter((item) => item.kind === "error");
  const warnings = diagnostics.filter((item) => item.kind === "warning");
  const ok = !timedOut && result.exitCode === 0 && !failed;
  const status = timedOut ? "timeout" : ok ? "success" : "failed";
  const durationSeconds = Math.round(duration * 100) / 100;
  const summary = [
    `${tool} ${status} for env ${environment || environments.join(",") || "default"} in ${durationSeconds}s.`,
  ];
  if (errors.length)
    summary.push(
      `${errors.length} error(s); first: ${errors[0].file}:${errors[0].line}: ${errors[0].message}`,
    );
  if (warnings.length) summary.push(`${warnings.length} warning(s).`);
  if (Object.keys(memory).length)
    summary.push(
      `RAM ${(memory.ram?.percent ?? 0).toFixed(1)}%, Flash ${(memory.flash?.percent ?? 0).toFixed(1)}%.`,
    );
  if (timedOut)
    summary.push(
      "The command timed out; first builds download toolchains and can take several minutes, retry once.",
    );
  return {
    ok,
    status,
    summary: summary.join(" "),
    environments,
    errors: errors.slice(0, 50),
    warnings: warnings.slice(0, 50),
    error_count: errors.length,
    warning_count: warnings.length,
    memory,
    duration_s: durationSeconds,
    exit_code: result.exitCode,
    log_path: result.logPath,
    output_tail: lines.slice(-40).join("\n"),
    port_error: ok ? null : classifyCleanPortError(output),
  };
}

/** Normalize reference CLI boilerplate before diagnostic parsing and tail projection. */
export function normalizeCleanOutput(output: string): string {
  const lines = output
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const result: string[] = [];
  let banner = false;
  for (const line of lines) {
    const stripped = line.trim();
    if (/^\*{21,}$/.test(stripped)) {
      banner = !banner;
      continue;
    }
    if (
      banner ||
      stripped === "Verbose mode can be enabled via `-v, --verbose` option" ||
      stripped ===
        "LDF: Library Dependency Finder -> https://bit.ly/configure-pio-ldf"
    )
      continue;
    result.push(line.trimEnd());
  }
  while (result.length && result.at(-1) === "") result.pop();
  return result.join("\n");
}

/** Preserve reference error precedence when build scripts encounter serial-port failures. */
function classifyCleanPortError(output: string): string | null {
  const patterns: [string, RegExp][] = [
    [
      "port_permission",
      /PermissionError\(13|Access is denied|Permission denied|Errno 13/i,
    ],
    [
      "port_busy",
      /Device or resource busy|Resource busy|Errno 16|port is busy|already in use/i,
    ],
    [
      "no_response",
      /Timed out waiting for packet header|Failed to connect to ESP|No serial data received|Wrong boot mode|Invalid head of packet|programmer is not responding|not in sync|stk500_recv\(\)|stk500_getsync\(\)|Failed to open the debug port|No device found on/i,
    ],
    [
      "port_missing",
      /could not open port|A fatal error occurred: Could not open|SerialException|No such file or directory: '?\/dev|Errno 2\b.*(?:tty|cu\.|COM)|FileNotFoundError.*(?:tty|cu\.|COM)|Could not find a port|No serial ports found/i,
    ],
  ];
  return patterns.find(([, pattern]) => pattern.test(output))?.[0] ?? null;
}

/** Project structured defects; tool failures and incomplete executions cannot be reported as success. */
export function checkCompatibilityResult(
  result: { exitCode: number; output: string; logPath: string },
  projectDir: string,
  severity: "low" | "medium" | "high",
  timedOut = false,
) {
  const output = normalizeCleanOutput(result.output);
  const failure = () => ({
    ok: false,
    error: "check_failed",
    summary: `pio check did not return a complete valid report (exit ${result.exitCode}).`,
    output_tail: output.split("\n").slice(-30).join("\n"),
    log_path: result.logPath,
  });
  if (timedOut) return { ...failure(), status: "timeout" };
  let report;
  try {
    report = summarizeCheckOutput(output, projectDir);
  } catch (error) {
    if (
      error instanceof PlatformIOError &&
      error.code?.startsWith("CHECK_REPORT_")
    )
      return failure();
    throw error;
  }
  const failed = report.tools.filter((tool) => !tool.succeeded);
  let summary = `${report.defect_count} defect(s) at severity >= ${severity}: ${report.by_severity.high} high, ${report.by_severity.medium} medium, ${report.by_severity.low} low.`;
  if (report.defects.length) {
    const defect = report.defects[0];
    summary += ` Top: [${defect.severity}] ${defect.file}:${defect.line} ${defect.message}`;
  }
  if (failed.length)
    summary +=
      " Tool(s) failed: " +
      failed.map((tool) => `${tool.tool}(${tool.env})`).join(", ");
  if (result.exitCode !== 0 && !report.tools.length) return failure();
  return { ok: !failed.length, summary, ...report, log_path: result.logPath };
}
