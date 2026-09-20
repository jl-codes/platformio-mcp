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

/** Run a capture with a host context already resolved by the caller. */
export async function captureTargetUpload(input: CaptureTargetUploadInput) {
  const context = {
    ...input.context,
    toolchain: { ...input.context.toolchain },
    uploader: { ...input.context.uploader },
    trustedImageRoots: [...(input.context.trustedImageRoots ?? [])],
  };
  if (input.execution.uploadPort !== context.uploader.port)
    throw new PlatformIOError(
      "Capture requires the selected upload destination.",
      "UPLOAD_CAPTURE_INVALID",
    );
  return withTargetUploadCapture(
    {
      projectDir: context.projectDir,
      environment: context.environment,
      execution: input.execution,
    },
    (recordPath, directory) =>
      retainUploadCapture(
        recordPath,
        { ...context, captureDirectory: directory },
        input.archiveRoot,
      ),
  );
}

/** Host-only capture scope; public tools must authorize build/upload effects before entering. */
export interface TargetUploadCaptureRequest {
  projectDir: string;
  environment: string;
  execution: Omit<TargetExecutionOptions, "captureEnvironment" | "onResult">;
}

/**
 * Execute the selected upload target with the final capture-and-stop hook. The host callback may
 * resolve registered tools from the record and retain its bytes before private capture cleanup.
 * Project and pre-upload scripts still execute, so this phase requires upload/build authorization.
 * Unconfirmed child closure keeps the private directory; capture is never proof of a flashed device.
 */
export async function withTargetUploadCapture<T>(
  input: TargetUploadCaptureRequest,
  use: (recordPath: string, captureDirectory: string) => Promise<T>,
): Promise<T> {
  const projectDir = input.projectDir;
  const environment = input.environment;
  const execution = { ...input.execution };
  if (
    !path.isAbsolute(projectDir) ||
    !/^[a-zA-Z0-9_-]{1,50}$/.test(environment) ||
    !execution.uploadPort
  )
    throw new PlatformIOError(
      "Capture requires an explicit project, environment and upload destination.",
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
    await buildTarget(projectDir, "upload", environment, false, {
      ...execution,
      captureEnvironment: uploadCaptureEnvironment(scriptPath),
      onResult: async (result) => {
        exitCode = result.exitCode;
      },
    });
    // Core maps failed actions to 1; SCons wraps action status 86 in a BuildError with exit status 2.
    // The private capture record must still validate; a nonzero exit alone never proves capture.
    if (exitCode !== 1 && exitCode !== 2 && exitCode !== 86)
      throw new PlatformIOError(
        "Upload target did not stop at the capture phase.",
        "UPLOAD_CAPTURE_FAILED",
      );
    return await use(recordPath, directory);
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
