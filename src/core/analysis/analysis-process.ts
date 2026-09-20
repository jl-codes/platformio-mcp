/** Bounded native analysis execution. This helper is internal and is not a shell-command tool. */
import { execFile } from "node:child_process";
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";

/** Limits for one selected analysis utility invocation. */
export interface AnalysisProcessOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  environment?: NodeJS.ProcessEnv; // Trusted caller overrides for offline utilities.
  allowedExitCodes?: readonly number[]; // Internal protocols may return structured errors on a known status.
}
/** Captured UTF-8 output; failed or truncated output is never reported as a successful analysis. */
export interface AnalysisProcessResult {
  stdout: string;
  stderr: string;
  exitCode?: number;
}

/**
 * Invokes an absolute native executable without a command shell.
 * The caller must resolve this executable from the selected trusted toolchain.
 * @param executable Validated absolute toolchain utility path.
 * @param args Exact argument array, including the selected ELF path.
 * @param options Bounded execution settings and cancellation signal.
 */
export async function runAnalysisProcess(
  executable: string,
  args: readonly string[],
  options: AnalysisProcessOptions = {},
): Promise<AnalysisProcessResult> {
  const timeout = options.timeoutMs ?? 30_000;
  const maxBuffer = options.maxOutputBytes ?? 16 * 1024 * 1024;
  if (!path.isAbsolute(executable) || /\.(?:cmd|bat|ps1|sh)$/i.test(executable))
    throw new PlatformIOError(
      "Analysis requires an absolute native executable path.",
      "ANALYSIS_EXECUTABLE_INVALID",
    );
  if (
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > 120_000 ||
    !Number.isInteger(maxBuffer) ||
    maxBuffer < 1 ||
    maxBuffer > 32 * 1024 * 1024
  )
    throw new PlatformIOError(
      "Analysis process limits are invalid.",
      "ANALYSIS_LIMIT_INVALID",
    );
  if (
    args.length > 8192 ||
    args.some((arg) => typeof arg !== "string" || arg.includes("\0")) ||
    args.reduce((total, arg) => total + Buffer.byteLength(arg), 0) > 256 * 1024
  )
    throw new PlatformIOError(
      "Analysis argument list is invalid or too large.",
      "ANALYSIS_ARGUMENT_INVALID",
    );
  if (
    options.allowedExitCodes?.some(
      (code) => !Number.isInteger(code) || code < 0 || code > 255,
    )
  )
    throw new PlatformIOError(
      "Invalid allowed exit code.",
      "ANALYSIS_LIMIT_INVALID",
    );
  if (options.signal?.aborted)
    throw new PlatformIOError("Analysis was cancelled.", "ANALYSIS_CANCELLED");
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      {
        cwd: options.cwd,
        timeout,
        maxBuffer,
        signal: options.signal,
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        killSignal: "SIGKILL",
        env: { ...process.env, ...options.environment, LC_ALL: "C", LANG: "C" },
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr });
          return;
        }
        const code = error.code as string | number | undefined;
        if (
          typeof code === "number" &&
          !error.killed &&
          !options.signal?.aborted &&
          options.allowedExitCodes?.includes(code)
        ) {
          resolve({ stdout, stderr, exitCode: code });
          return;
        }
        const failure =
          options.signal?.aborted || error.name === "AbortError"
            ? "ANALYSIS_CANCELLED"
            : code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
              ? "ANALYSIS_OUTPUT_LIMIT"
              : error.killed
                ? "ANALYSIS_TIMEOUT"
                : code === "ENOENT" || code === "EACCES"
                  ? "ANALYSIS_TOOL_UNAVAILABLE"
                  : "ANALYSIS_TOOL_FAILED";
        // Do not expose raw command strings, environment or potentially secret tool output.
        reject(
          new PlatformIOError(
            `Analysis utility failed (${failure}).`,
            failure,
            {
              executable: path.basename(executable),
              exitCode: typeof code === "number" ? code : undefined,
            },
          ),
        );
      },
    );
  });
}

