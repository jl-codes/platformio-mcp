/** Install a final capture hook without replacing the project's configured extra scripts. */
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";

/**
 * Core 6.1.16 appends PLATFORMIO_EXTRA_SCRIPTS to configured scripts. Preserve inherited values and
 * append the host hook last; reject ambiguous comma-only lists whose meaning changes on newline join.
 * This host-only override is passed to one child and never mutates the server's process environment.
 */
export function uploadCaptureEnvironment(
  scriptPath: string,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!path.isAbsolute(scriptPath) || /[\x00-\x1f\x7f;$]/.test(scriptPath))
    throw new PlatformIOError(
      "Invalid capture script path.",
      "UPLOAD_CAPTURE_INVALID",
    );
  const previous =
    inherited.PLATFORMIO_EXTRA_SCRIPTS ||
    inherited.PLATFORMIO_EXTRA_SCRIPT ||
    "";
  if (
    previous.length > 65536 ||
    /[\x00\x7f]/.test(previous) ||
    (!previous.includes("\n") && previous.includes(", "))
  )
    throw new PlatformIOError(
      "Inherited extra scripts cannot be extended without changing their interpretation.",
      "UPLOAD_CAPTURE_UNSUPPORTED",
    );
  return {
    // SCons prints source paths before invoking the capture action; match our UTF-8 log decoder.
    PYTHONIOENCODING: "utf-8",
    PLATFORMIO_EXTRA_SCRIPTS: `${previous}${previous ? "\n" : ""}post:${scriptPath}\n`,
  };
}
