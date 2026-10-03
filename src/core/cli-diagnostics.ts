import { ZodError } from "zod";
import {
  BoardNotFoundError,
  BuildError,
  PlatformIOError,
  PlatformIONotInstalledError,
  ProjectInitError,
  UploadError,
  formatPlatformIOError,
} from "../utils/errors.js";

export type CliStructuredError = {
  success: false;
  stage: string;
  errorType: string;
  summary: string;
  recommendedAction: string;
  safeToAutoRetry: boolean;
  logPath?: string;
  details?: unknown;
};

function inferStage(error: unknown, fallbackStage?: string): string {
  if (fallbackStage) return fallbackStage;
  if (error instanceof ProjectInitError) return "init";
  if (error instanceof BuildError) return "build";
  if (error instanceof UploadError) return "upload";
  if (error instanceof BoardNotFoundError) return "boards";
  if (error instanceof PlatformIONotInstalledError) return "system";
  if (error instanceof ZodError) return "validation";
  return "unknown";
}

function inferErrorType(error: unknown): string {
  if (error instanceof ZodError) return "InvalidArguments";
  if (error instanceof PlatformIOError) {
    if (error.code === "PORT_BUSY") return "PortBusy";
    if (error.code === "PORT_NOT_FOUND") return "PortNotFound";
    if (error.code === "INVALID_PORT") return "InvalidPort";
    if (error.code === "INVALID_BAUD") return "InvalidBaudRate";
    if (error.code === "EXPECTATION_TIMEOUT") return "ExpectationTimeout";
    if (error.code === "BUILD_FAILED") return "BuildFailed";
    if (error.code === "UPLOAD_FAILED") return "UploadFailed";
    if (error.code === "PROJECT_INIT_FAILED") return "ProjectInitFailed";
    if (error.code === "BOARD_NOT_FOUND") return "WrongBoard";
    if (error.code === "PLATFORMIO_NOT_INSTALLED")
      return "PlatformIONotInstalled";
    if (error.code === "APPROVAL_REQUIRED") return "ApprovalRequired";
    if (error.code === "APPROVAL_DENIED") return "ApprovalDenied";
    if (error.code === "POLICY_DENIED") return "PolicyDenied";
    // Argument errors raised by the CLI's own handlers. Without these they fall
    // through to the raw code and surface as SCREAMING_SNAKE while every other
    // errorType is PascalCase, which makes the field awkward to match on.
    if (error.code === "MISSING_ARGUMENT") return "MissingArgument";
    if (error.code === "UNKNOWN_SUBCOMMAND") return "UnknownSubcommand";
    if (error.code === "INVALID_ARGUMENT") return "InvalidArgument";
    // Codes that reach agents from the hardware and library paths. Without
    // these they fall through to the raw code and arrive as SCREAMING_SNAKE
    // while every other errorType is PascalCase.
    if (error.code === "TARGET_UNAVAILABLE") return "TargetUnavailable";
    if (error.code === "STALE_TARGET_BINDING") return "StaleTargetBinding";
    if (error.code === "LIBRARY_ERROR") return "LibraryError";
    if (error.code === "QUEUE_ENFORCEMENT_FAILED")
      return "QueueEnforcementFailed";
    if (error.code === "AMBIGUOUS_TARGET") return "AmbiguousTarget";
    if (error.code === "AMBIGUOUS_TASK") return "AmbiguousTask";
    if (error.code === "LIST_DEVICES_FAILED") return "ListDevicesFailed";
    if (error.code === "APPROVAL_NOT_FOUND") return "ApprovalNotFound";
    if (error.code === "CLAIM_IO_ERROR") return "ClaimIoError";
    if (error.code === "CLAIM_ACCESS_DENIED") return "ClaimAccessDenied";
    return error.code ?? error.name;
  }
  if (error instanceof Error) return error.name || "Error";
  return "Unknown";
}

function inferRecommendedAction(errorType: string, stage: string): string {
  switch (errorType) {
    case "PortBusy":
      return (
        "Another process holds this port. Report the holding PID and workspace " +
        "to the user rather than retrying; if it is known to be finished, run " +
        "`pio-agent port release --port <port>`."
      );
    case "ClaimIoError":
      return (
        "The port claim directory could not be written. Check free space and " +
        "permissions, or set PIO_MCP_DATA_DIR to a writable path."
      );
    case "ClaimAccessDenied":
      return (
        "A port claim file exists but cannot be read, so it was not reclaimed " +
        "in case it is live. Check permissions, or run " +
        "`pio-agent port release --port <port>` if you are certain it is stale."
      );
    case "PortNotFound":
      return "Reconnect the device, run device discovery again, and retry.";
    case "WrongBoard":
      return "Run board search and use the exact PlatformIO board ID.";
    case "BuildFailed":
      return "Inspect the summarized compiler diagnostics and patch the smallest failing unit first.";
    case "UploadFailed":
      return "Verify cable/power and selected port, then retry upload.";
    case "PlatformIONotInstalled":
      return "Install PlatformIO Core CLI and ensure `pio` is available in PATH.";
    case "InvalidArguments":
      return "Run the same command with `--help` and provide required options.";
    case "ExpectationTimeout":
      return "Increase --timeout, confirm baud/port, and verify the firmware prints the expected marker.";
    case "ApprovalRequired":
      return "Re-run with --approve or confirm when prompted.";
    case "ApprovalDenied":
      return "Operation was not approved. Re-run and approve if you intend to perform this hardware action.";
    case "AmbiguousTarget":
      return (
        "More than one device matches. Re-run with an explicit --port, or use " +
        "`pio-agent target-resolve` to pick one binding."
      );
    case "AmbiguousTask":
      return "That id matches more than one task. Use the exact task id from `pio-agent task-history`.";
    case "ListDevicesFailed":
      return "Serial devices could not be listed. Confirm PlatformIO is installed and on PATH (`pio-agent system-info`).";
    case "ApprovalNotFound":
      return "No such approval in this scope. List current ones with `pio-agent pending-approvals --project-dir <dir>`.";
    case "TargetUnavailable":
      return (
        "No device is attached at that port. Run `pio-agent devices` to list " +
        "what is connected, then `pio-agent target-resolve` to pick a binding."
      );
    case "StaleTargetBinding":
      return "The cached target binding no longer matches the device. Re-run `pio-agent target-resolve`.";
    case "LibraryError":
      return (
        "Check the library identifier. PlatformIO's canonical form is " +
        "`owner/name`, e.g. `bblanchon/ArduinoJson`; `pio-agent lib search <query>` lists matches."
      );
    case "QueueEnforcementFailed":
      return (
        "Another operation holds the in-process pipeline lock. Wait for it to " +
        "finish; if nothing is running, check `pio-agent lock status`."
      );
    case "MissingArgument":
      return "Supply the missing option. Run the command with `--help` to see its required arguments.";
    case "UnknownSubcommand":
      return "Use one of the subcommands listed in the error summary, or run the command with `--help`.";
    case "InvalidArgument":
      return "Correct the malformed option value shown in the error summary and rerun.";
    case "PolicyDenied":
      return "Adjust the request to comply with policy or update policy configuration intentionally.";
    default:
      if (stage === "upload")
        return "Review upload logs and retry after resolving the blocking condition.";
      if (stage === "build")
        return "Review build logs and apply a minimal code/config fix before retrying.";
      return "Review the error summary and rerun with corrected input.";
  }
}

function inferSafeRetry(errorType: string): boolean {
  return [
    "PortNotFound",
    "UploadFailed",
    "BuildFailed",
    "InvalidArguments",
    "ExpectationTimeout",
  ].includes(errorType);
}

export function toCliStructuredError(
  error: unknown,
  opts?: { stage?: string; logPath?: string },
): CliStructuredError {
  const stage = inferStage(error, opts?.stage);
  const errorType = inferErrorType(error);
  const summary = formatPlatformIOError(error);

  const details =
    error instanceof ZodError
      ? error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      : error instanceof PlatformIOError
        ? error.context
        : undefined;

  return {
    success: false,
    stage,
    errorType,
    summary,
    recommendedAction: inferRecommendedAction(errorType, stage),
    safeToAutoRetry: inferSafeRetry(errorType),
    logPath: opts?.logPath,
    details,
  };
}
