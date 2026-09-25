/** Capture once and resume the exact approved firmware under the canonical upload lock and device owner. */
import { PlatformIOError } from "../utils/errors.js";
import { retainCommandLog } from "../utils/command-log.js";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { acquireProcessDeviceCustody } from "../core/devices/process-device-custody.js";
import { ProcessCustodySequence } from "../core/devices/process-custody-sequence.js";
import { resolveSerialEndpoint } from "../core/devices/serial-endpoint.js";
import { captureRegisteredUpload } from "../core/analysis/capture-registered-upload.js";
import {
  executeRetainedEspUpload,
  UploadCleanupFailure,
} from "../core/analysis/retained-upload-execution.js";
import type { SerialClientContext } from "../adapters/serial-client.js";
import type { HostUploadExecutor } from "./run-target.js";
import { getSystemInfo } from "./projects.js";

/** Public approval references; executable paths and custody remain host-owned. */
export interface ManifestUploadControls {
  resumeId?: string;
  manifestApprovalId?: string;
  systemApprovalId?: string;
}

/** Called only inside executeNamedTarget's authorized upload callback and existing hardware lock. */
export async function executeManifestUpload(
  input: Parameters<HostUploadExecutor>[0],
  client: SerialClientContext,
  caller: PolicyEvaluationContext,
  controls: ManifestUploadControls,
) {
  const options = { ...input };
  if (!options.environment || !options.uploadPort)
    throw new PlatformIOError(
      "Retained upload requires an explicit environment and port.",
      "UPLOAD_CAPTURE_INVALID",
    );
  const scope = {
    projectDir: options.projectDir,
    environment: options.environment,
    uploadPort: options.uploadPort,
    deviceBinding: options.deviceBinding,
  };
  const guard = createPolicyRevisionGuard(scope.projectDir);
  guard();
  const endpoint = resolveSerialEndpoint(
    options.serialPort ?? scope.uploadPort,
  );
  const parent =
    options.deviceCustody ??
    acquireProcessDeviceCustody(endpoint.canonicalPort);
  let phases = 0;
  const sequence = new ProcessCustodySequence(parent, async () => {
    guard();
    if (options.cancellation?.aborted)
      throw new PlatformIOError("Upload cancelled.", "PROCESS_CANCELLED", {
        cleanupPending: false,
      });
    endpoint.revalidate();
    if (phases++ > 0) {
      if (!parent.revalidateSpawn)
        throw new PlatformIOError(
          "Fresh upload device validation is unavailable.",
          "UPLOAD_CUSTODY_MISMATCH",
        );
      await parent.revalidateSpawn();
    }
    guard();
  });
  let resumeId = controls.resumeId;
  let manifestSha256: string | undefined;
  let uncertain = false;
  try {
    if (!resumeId) {
      const systemInfo = await dispatchAuthorizedAction(
        "system_info",
        {
          projectDir: scope.projectDir,
          purpose: "upload_tools",
          approvalId: controls.systemApprovalId,
        },
        { ...caller, workspaceDir: scope.projectDir },
        getSystemInfo,
      );
      guard();
      const captured = await captureRegisteredUpload(
        {
          projectDir: scope.projectDir,
          environment: scope.environment,
          execution: { ...options, deviceCustody: sequence.nextPhase() },
        },
        systemInfo,
      );
      guard();
      const staged = client.pendingUploads.stage(
        captured.retained,
        scope,
        guard,
        async (signal, execution) => {
          if (!execution)
            throw new PlatformIOError(
              "Resume requires fresh owned execution controls.",
              "UPLOAD_RESUME_UNAVAILABLE",
            );
          const combined = execution.signal
            ? AbortSignal.any([signal, execution.signal])
            : signal;
          return executeRetainedEspUpload(
            captured.retained,
            captured.uploader,
            { ...execution, signal: combined },
          );
        },
      );
      resumeId = staged.resumeId;
      manifestSha256 = staged.manifestSha256;
    }
    const result = await client.pendingUploads.resume(
      resumeId,
      scope,
      controls.manifestApprovalId,
      caller,
      {
        custody: sequence.nextPhase(),
        guard,
        signal: options.cancellation,
        timeoutMs: options.timeoutMs,
        finishCustody: () => sequence.finish(),
      },
    );
    guard();
    const log = await retainCommandLog("target", result.output, "");
    await options.onResult?.({
      exitCode: result.exitCode,
      finalOutput: result.output,
      fullLogPath: log,
    });
    return result;
  } catch (error) {
    uncertain =
      error instanceof PlatformIOError &&
      error.context?.cleanupPending === true;
    if (
      error instanceof PlatformIOError &&
      error.code === "APPROVAL_REQUIRED" &&
      resumeId
    )
      throw new PlatformIOError(error.message, error.code, {
        ...error.context,
        resumeId,
        manifestSha256,
      });
    throw error;
  } finally {
    if (!uncertain) {
      try {
        sequence.finish();
      } catch {
        const failure = new UploadCleanupFailure(async () => sequence.finish());
        client.pendingUploads.retainCleanup(failure);
        throw failure;
      }
    }
  }
}
