/** Authorize reference cleanup through the canonical destructive action and shared execution lock. */
import fs from "node:fs/promises";
import { z } from "zod";
import { cleanProject } from "../tools/build.js";
import { BuildError, PlatformIOError } from "../utils/errors.js";
import { hardwareLockManager } from "../utils/lock-manager.js";
import { retainCommandLog } from "../utils/command-log.js";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import { redactSecretsInText } from "../core/policy/redact.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import {
  resolveCompatibilityProject,
  type CompatibilityProjectDefaults,
} from "./compatibility-project.js";

/** Execute selected clean target only after the exact request is authorized. */
export async function executeCleanCompatibility(
  input: unknown,
  defaults: CompatibilityProjectDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const params = z
    .object({
      project_dir: z.string().max(32768).nullable().optional(),
      env: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,50}$/)
        .nullable()
        .optional(),
      full: z.boolean().default(false),
      approval_id: z.string().max(256).optional(),
    })
    .strict()
    .parse(input);
  const projectDir = await resolveCompatibilityProject(
    params.project_dir,
    defaults,
  );
  const environment = params.env ?? undefined;
  return dispatchAuthorizedAction(
    "clean_project",
    {
      projectDir,
      environment,
      full: params.full,
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
        try {
          await cleanProject(projectDir, false, {
            environment,
            full: params.full,
            timeoutMs: 120000,
            onResult: async (result) => {
              guard();
              const handle = await fs.open(result.fullLogPath, "r");
              let output: string;
              try {
                const stat = await handle.stat();
                const limit = 16 * 1024 * 1024;
                if (!stat.isFile() || stat.size > limit)
                  throw new PlatformIOError(
                    "Clean output exceeds the report limit",
                    "COMMAND_LOG_LIMIT",
                  );
                const buffer = Buffer.alloc(stat.size + 1);
                let offset = 0;
                while (offset < buffer.length) {
                  const read = await handle.read(
                    buffer,
                    offset,
                    buffer.length - offset,
                    offset,
                  );
                  if (!read.bytesRead) break;
                  offset += read.bytesRead;
                }
                if (offset > stat.size)
                  throw new PlatformIOError(
                    "Clean output changed during collection",
                    "COMMAND_LOG_CHANGED",
                  );
                output = redactSecretsInText(
                  buffer.subarray(0, offset).toString("utf8"),
                ).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
              } finally {
                await handle.close();
              }
              guard();
              const logPath = await retainCommandLog("clean", output, "");
              completed = { exitCode: result.exitCode, output, logPath };
            },
          });
        } catch (error) {
          if (
            !(error instanceof BuildError) ||
            !completed ||
            error.context?.exitCode !== completed.exitCode
          )
            throw error;
        }
        guard();
        if (!completed)
          throw new PlatformIOError(
            "Clean result was not collected",
            "COMPAT_RESULT_INVALID",
          );
        return cleanCompatibilityResult(
          completed,
          environment,
          (performance.now() - started) / 1000,
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
  const ok = result.exitCode === 0 && !failed;
  const status = ok ? "success" : "failed";
  const durationSeconds = Math.round(duration * 100) / 100;
  const summary = [
    `clean ${status} for env ${environment || environments.join(",") || "default"} in ${durationSeconds}s.`,
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
