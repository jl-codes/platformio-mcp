/**
 * Error Handling Utilities
 * Custom error classes and error formatting utilities.
 *
 * Provides:
 * - PlatformIOError: Base error class.
 * - PlatformIONotInstalledError: Environment configuration error.
 * - BoardNotFoundError: Board resolution error.
 * - ProjectInitError: Initialization failure error.
 * - BuildError: Compilation failure error.
 * - UploadError: Upload execution error.
 * - LibraryError: Dependency resolution error.
 * - CommandTimeoutError: Process timeout error.
 * - formatPlatformIOError: Standardizes error messages.
 * - parseStderrErrors: Extracts error codes from output.
 * - isPlatformIONotFoundError: Validates environment issues.
 */

/**
 * Base error class for PlatformIO-related errors
 */
export class PlatformIOError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PlatformIOError";
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error thrown when PlatformIO CLI is not installed or not found in the system PATH.
 */
export class PlatformIONotInstalledError extends PlatformIOError {
  constructor(
    message = "PlatformIO CLI is not installed or not found in PATH",
  ) {
    super(message, "PLATFORMIO_NOT_INSTALLED");
    this.name = "PlatformIONotInstalledError";
  }
}

/**
 * Error thrown when a board ID is invalid or cannot be resolved in the PlatformIO registry.
 */
export class BoardNotFoundError extends PlatformIOError {
  constructor(boardId: string) {
    super(
      `Board '${boardId}' not found in PlatformIO registry`,
      "BOARD_NOT_FOUND",
      { boardId },
    );
    this.name = "BoardNotFoundError";
  }
}

/**
 * Error thrown when the `project init` command fails to scaffold a new codebase.
 */
export class ProjectInitError extends PlatformIOError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "PROJECT_INIT_FAILED", context);
    this.name = "ProjectInitError";
  }
}

/**
 * Error thrown when the `run` command fails during the compilation phase.
 */
export class BuildError extends PlatformIOError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "BUILD_FAILED", context);
    this.name = "BuildError";
  }
}

/**
 * Error thrown when the firmware or filesystem upload operation fails to reach the device.
 */
export class UploadError extends PlatformIOError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "UPLOAD_FAILED", context);
    this.name = "UploadError";
  }
}

/**
 * Error thrown during library registry interactions (install, search, update).
 */
export class LibraryError extends PlatformIOError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "LIBRARY_ERROR", context);
    this.name = "LibraryError";
  }
}

/**
 * Error thrown when a child process execution exceeds the defined timeout limit.
 */
export class CommandTimeoutError extends PlatformIOError {
  constructor(command: string, timeout: number) {
    super(
      `Command '${command}' timed out after ${timeout}ms`,
      "COMMAND_TIMEOUT",
      {
        command,
        timeout,
      },
    );
    this.name = "CommandTimeoutError";
  }
}

/**
 * Formats a PlatformIO error into a user-friendly message with troubleshooting hints.
 *
 * @param error - The raw error caught from execution.
 * @returns Formatted and localized troubleshooting message.
 */
export function formatPlatformIOError(error: unknown): string {
  if (error instanceof PlatformIONotInstalledError) {
    return (
      `${error.message}\n\nTroubleshooting:\n` +
      `1. Install PlatformIO Core CLI: https://docs.platformio.org/en/latest/core/installation.html\n` +
      `2. Ensure 'pio' or 'platformio' is in your system PATH\n` +
      `3. Try running: pip install platformio`
    );
  }

  if (error instanceof BoardNotFoundError) {
    return (
      `${error.message}\n\nTroubleshooting:\n` +
      `1. Check board ID spelling (case-sensitive)\n` +
      `2. List available boards with: pio boards\n` +
      `3. Search for your board at: https://docs.platformio.org/en/latest/boards/`
    );
  }

  if (error instanceof ProjectInitError) {
    return (
      `${error.message}\n\nTroubleshooting:\n` +
      `1. Ensure the target directory exists and is writable\n` +
      `2. Verify the board ID is correct\n` +
      `3. Check that the framework is supported for this board`
    );
  }

  if (error instanceof BuildError) {
    return (
      `${error.message}\n\nTroubleshooting:\n` +
      `1. Check your source code for syntax errors\n` +
      `2. Ensure all required libraries are installed\n` +
      `3. Verify platformio.ini configuration is correct\n` +
      `4. Try cleaning the project: pio run -t clean`
    );
  }

  if (error instanceof UploadError) {
    return (
      `${error.message}\n\nTroubleshooting:\n` +
      `1. Ensure the device is connected and powered\n` +
      `2. Check USB cable and drivers\n` +
      `3. Verify the correct port is specified\n` +
      `4. Try resetting the device\n` +
      `5. Check that no other programs are using the serial port`
    );
  }

  if (error instanceof LibraryError) {
    return (
      `${error.message}\n\nTroubleshooting:\n` +
      `1. Check library name spelling\n` +
      `2. Verify internet connection\n` +
      `3. Try updating library registry: pio lib update`
    );
  }

  if (error instanceof PlatformIOError) {
    let message = error.message;
    if (error.context) {
      message += "\n\nContext: " + JSON.stringify(error.context, null, 2);
    }
    return message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Extracts relevant error information from PlatformIO CLI stderr output.
 *
 * @param stderr - Target output string buffer to search.
 * @returns Array of identified critical error messages.
 */
export function parseStderrErrors(stderr: string): string[] {
  const errors: string[] = [];
  const lines = stderr.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Common error patterns
    if (
      trimmed.includes("error:") ||
      trimmed.includes("Error:") ||
      trimmed.includes("ERROR:") ||
      trimmed.includes("fatal:") ||
      trimmed.includes("Failed")
    ) {
      errors.push(trimmed);
    }
  }

  return errors;
}

/**
 * A single structured build error with its source location, raw text, and a
 * categorical tag the UI can format on. Mirrors what gcc/clang/PIO already
 * emit; we just lift the structure out of the log so agents don't have to
 * scan ~600 lines of stdout to find it.
 */
export interface StructuredBuildError {
  /** Categorical tag — drives the matching `nextStep` hint. */
  category:
    | "missing_header"
    | "undefined_reference"
    | "syntax"
    | "missing_library"
    | "missing_platformio_ini"
    | "missing_environment"
    | "permission"
    | "toolchain"
    | "unknown";
  /** One-line human-readable summary, suitable as a UI bullet point. */
  message: string;
  /** Source file relative to project, if extractable. */
  file?: string;
  /** Source line number, if extractable. */
  line?: number;
  /** Verbatim log line that triggered detection — useful for debugging the parser itself. */
  raw: string;
}

/**
 * Extracts structured errors from a build log. Walks the log once,
 * applying ordered pattern matchers; the first match wins per line so we
 * don't double-classify (e.g. a gcc "fatal error: X.h: No such file" both
 * has `fatal` and `error:` keywords but is really one missing-header event).
 *
 * Designed to be cheap on success (early return on empty log) and forgiving
 * on weird log content (always returns a — possibly empty — array, never
 * throws).
 *
 * @param log - Combined stdout+stderr from `pio run` or similar.
 */
export function parseStructuredBuildErrors(log: string): StructuredBuildError[] {
  if (!log) return [];
  const out: StructuredBuildError[] = [];
  const lines = log.split(/\r?\n/);

  // gcc "fatal error: foo.h: No such file or directory" (header missing)
  const reMissingHeader =
    /^(.*?):(\d+)(?::\d+)?:\s*fatal error:\s*([^:]+?):\s*No such file or directory/i;
  // gcc "error: 'x' was not declared in this scope" / "expected ';' before"
  const reSyntax = /^(.*?):(\d+)(?::\d+)?:\s*error:\s*(.+)$/i;
  // linker "undefined reference to `foo'"
  const reUndefRef = /undefined reference to\s+[`']?([^'"`\s]+)[`']?/i;
  // PIO meta: missing project config
  const reMissingIni = /(platformio\.ini.*not (found|exist))|Project does not seem to be a PlatformIO Project/i;
  // PIO meta: bad environment name
  const reMissingEnv = /UnknownEnvNames|environment.*not found|UndefinedEnvError/i;
  // Library resolve failures
  const reLibMissing = /Library Manager:\s*(Warning|Error).*not found|LibraryNotFound/i;
  // Permission / disk
  const rePermission = /(EACCES|Permission denied|EPERM)/i;
  // Toolchain install fail
  const reToolchain = /(Could not install package|failed to download|PackageException)/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let m: RegExpExecArray | null;

    if ((m = reMissingHeader.exec(trimmed))) {
      out.push({
        category: "missing_header",
        message: `Missing header: ${m[3]} (in ${m[1]}:${m[2]})`,
        file: m[1],
        line: Number(m[2]),
        raw: trimmed,
      });
      continue;
    }
    if ((m = reUndefRef.exec(trimmed))) {
      out.push({
        category: "undefined_reference",
        message: `Undefined reference to '${m[1]}' — symbol not linked.`,
        raw: trimmed,
      });
      continue;
    }
    if ((m = reSyntax.exec(trimmed))) {
      out.push({
        category: "syntax",
        message: `${m[3]} (in ${m[1]}:${m[2]})`,
        file: m[1],
        line: Number(m[2]),
        raw: trimmed,
      });
      continue;
    }
    if (reMissingIni.test(trimmed)) {
      out.push({
        category: "missing_platformio_ini",
        message: "platformio.ini missing or invalid — project is not initialized.",
        raw: trimmed,
      });
      continue;
    }
    if (reMissingEnv.test(trimmed)) {
      out.push({
        category: "missing_environment",
        message: "Requested environment is not defined in platformio.ini.",
        raw: trimmed,
      });
      continue;
    }
    if (reLibMissing.test(trimmed)) {
      out.push({
        category: "missing_library",
        message: "A required library is missing or could not be resolved.",
        raw: trimmed,
      });
      continue;
    }
    if (rePermission.test(trimmed)) {
      out.push({
        category: "permission",
        message: "Permission denied accessing project / build artifacts.",
        raw: trimmed,
      });
      continue;
    }
    if (reToolchain.test(trimmed)) {
      out.push({
        category: "toolchain",
        message: "Toolchain/package install failed — likely a network or registry issue.",
        raw: trimmed,
      });
      continue;
    }
  }

  // Dedupe by (category, message) to keep the list short — duplicate gcc
  // diagnostics on the same line are common and add no signal.
  const seen = new Set<string>();
  return out.filter((e) => {
    const k = e.category + "|" + e.message;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Translates structured build errors into actionable next-step instructions
 * the agent can act on without re-reading the log. EmbedBench traces showed
 * agents repeatedly re-issuing identical edits after build failures because
 * the unstructured log buried the "what should I do" signal. Returning
 * `nextSteps` alongside errors gives the model a concrete plan in its first
 * tokens of context.
 *
 * The returned array is always present (possibly empty) so callers can rely
 * on a stable shape.
 *
 * @param errors - Structured errors from {@link parseStructuredBuildErrors}.
 * @param success - Whether the build succeeded. On success we still emit
 *   forward-looking hints ("Run upload_firmware to flash the device").
 */
export function deriveNextSteps(
  errors: StructuredBuildError[],
  success: boolean,
): string[] {
  if (success) {
    return [
      "Build succeeded. Call upload_firmware (preferred over `pio run --target upload`) to flash the device.",
      "Optionally call start_monitor to capture serial output, then query_logs to inspect it.",
    ];
  }

  // Per-category mapping. We add the *first* matching tip per category to
  // keep the list short; if the agent fixes one root cause the rest usually
  // disappear in the next iteration.
  const tips: string[] = [];
  const seen = new Set<string>();
  for (const e of errors) {
    if (seen.has(e.category)) continue;
    seen.add(e.category);
    switch (e.category) {
      case "missing_header":
        tips.push(
          "Header file not found — add the providing library to `lib_deps` in platformio.ini (search via `search_libraries`), then call `build_project` again.",
        );
        break;
      case "undefined_reference":
        tips.push(
          "Undefined linker reference — ensure the source/library that defines this symbol is present. If it's from a third-party library, add it to `lib_deps` and rebuild.",
        );
        break;
      case "syntax":
        tips.push(
          "Syntax error in source — open the indicated file:line, fix the offending statement, then call `build_project` again. Avoid re-issuing the same edit twice.",
        );
        break;
      case "missing_library":
        tips.push(
          "Library could not be resolved — verify the entry in `lib_deps`, run `search_libraries` to confirm the registry id, then rebuild.",
        );
        break;
      case "missing_platformio_ini":
        tips.push(
          "platformio.ini is missing or malformed — run `init_project` to regenerate the scaffold, then `build_project` again.",
        );
        break;
      case "missing_environment":
        tips.push(
          "Environment not declared in platformio.ini — call `get_project_config` to inspect available environments, then pass the correct `environment` argument to `build_project`.",
        );
        break;
      case "permission":
        tips.push(
          "Filesystem permission error — verify the project directory is writable and not held by another process; on macOS check that Terminal/IDE has Full Disk Access.",
        );
        break;
      case "toolchain":
        tips.push(
          "Toolchain/package install failed — check network access; if behind a proxy, configure PlatformIO accordingly, then rebuild.",
        );
        break;
      case "unknown":
      default:
        break;
    }
  }

  if (tips.length === 0) {
    // Fallback when the parser didn't classify anything — still give the
    // agent a structured plan rather than dropping it into a raw log.
    tips.push(
      "Build failed but no structured error was matched. Read the bottom of the build log for the actual gcc/clang error, then make the smallest targeted edit and call `build_project` again.",
    );
  }

  // Always nudge the agent to use MCP rather than the shell — EmbedBench
  // observed gpt-5-codex repeatedly running `pio run` directly when stuck.
  tips.push(
    "Use the `build_project` MCP tool to compile — do NOT run `pio run` in a terminal; the MCP path integrates with the hardware lock, cache, and structured error parser.",
  );

  return tips;
}

/**
 * Checks if an error indicates PlatformIO is not installed.
 *
 * @param error - Caught exception object block.
 * @returns True if error originates from missing command interpreter.
 */
export function isPlatformIONotFoundError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("enoent") ||
      message.includes("not found") ||
      message.includes("command not found") ||
      (message.includes("platformio") && message.includes("not recognized"))
    );
  }
  return false;
}
