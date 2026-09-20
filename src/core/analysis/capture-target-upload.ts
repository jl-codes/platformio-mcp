/** Capture and retain the actual selected upload inputs through the owned target execution path. */
import fs from "node:fs/promises";
import path from "node:path";
import { buildTarget, type TargetExecutionOptions } from "../../tools/build.js";
import { PlatformIOError } from "../../utils/errors.js";
import { createPrivateAnalysisDirectory } from "./private-analysis-directory.js";
import { createUploadCaptureScript } from "./upload-capture-script.js";
import { uploadCaptureEnvironment } from "./upload-capture-environment.js";
import {
  retainUploadCapture,
  type UploadCaptureContext,
} from "./upload-capture-record.js";

/** Selected host context for one already-authorized capture phase. */
export interface CaptureTargetUploadInput {
  context: Omit<UploadCaptureContext, "captureDirectory">;
  execution: Omit<TargetExecutionOptions, "captureEnvironment" | "onResult">;
  archiveRoot?: string;
}

/**
 * Run the real upload target with a final capture-and-stop hook, then retain the selected bytes.
 * The caller must authorize upload/build effects and retain device ownership: project scripts and
 * PlatformIO's pre-upload actions still execute. A captured record is not proof of a flashed device.
 * Unconfirmed process closure retains the private hook directory for the surviving child.
 */
export async function captureTargetUpload(input: CaptureTargetUploadInput) {
  const context = {
    ...input.context,
    toolchain: { ...input.context.toolchain },
    uploader: { ...input.context.uploader },
    trustedImageRoots: [...(input.context.trustedImageRoots ?? [])],
  };
  const execution = { ...input.execution };
  if (execution.uploadPort !== context.uploader.port || !context.environment)
    throw new PlatformIOError(
      "Capture requires the explicitly selected upload destination and environment.",
      "UPLOAD_CAPTURE_INVALID",
    );
  const directory = await fs.realpath(await createPrivateAnalysisDirectory());
  let cleanupPending = false;
  try {
    const recordPath = path.join(directory, "selection.json");
    const scriptPath = path.join(directory, "capture.py");
    await fs.writeFile(scriptPath, createUploadCaptureScript(recordPath), {
      flag: "wx",
      mode: 0o600,
    });
    let exitCode: number | undefined;
    await buildTarget(
      context.projectDir,
      "upload",
      context.environment,
      false,
      {
        ...execution,
        captureEnvironment: uploadCaptureEnvironment(scriptPath),
        onResult: async (result) => {
          exitCode = result.exitCode;
        },
      },
    );
    // Core returns 1 for a failed SCons action; direct SCons may preserve the hook's status 86.
    if (exitCode !== 1 && exitCode !== 86)
      throw new PlatformIOError(
        "Upload target did not stop at the capture phase.",
        "UPLOAD_CAPTURE_FAILED",
      );
    return await retainUploadCapture(
      recordPath,
      { ...context, captureDirectory: directory },
      input.archiveRoot,
    );
  } catch (error) {
    cleanupPending =
      error instanceof PlatformIOError &&
      error.context?.cleanupPending === true;
    throw error;
  } finally {
    if (!cleanupPending)
      await fs.rm(directory, { recursive: true, force: true });
  }
}
