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
    if (error.code === "PLATFORMIO_NOT_INSTALLED") return "PlatformIONotInstalled";
    if (error.code === "APPROVAL_REQUIRED") return "ApprovalRequired";
    if (error.code === "APPROVAL_DENIED") return "ApprovalDenied";
    if (error.code === "POLICY_DENIED") return "PolicyDenied";
    return error.code ?? error.name;
  }
  if (error instanceof Error) return error.name || "Error";
  return "Unknown";
}

function inferRecommendedAction(errorType: string, stage: string): string {
  switch (errorType) {
    case "PortBusy":
      return "Stop the active monitor or process using the port, then retry.";
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
    case "PolicyDenied":
      return "Adjust the request to comply with policy or update policy configuration intentionally.";
    default:
      if (stage === "upload") return "Review upload logs and retry after resolving the blocking condition.";
      if (stage === "build") return "Review build logs and apply a minimal code/config fix before retrying.";
      return "Review the error summary and rerun with corrected input.";
  }
}

function inferSafeRetry(errorType: string): boolean {
  return [
    "PortBusy",
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
