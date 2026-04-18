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
