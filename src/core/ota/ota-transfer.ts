/** Transfer an already selected immutable image through separately authorized device and uploader stages. */
import { dispatchAuthorizedAction, planAction } from "../action-dispatcher.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import {
  acquireOtaCustody,
  type resolveOtaTarget,
} from "../devices/ota-target.js";
import type { retainOtaImage } from "./ota-artifacts.js";
import type { resolveOtaTools } from "./ota-tools.js";
import { runEspotaProcess } from "./espota-process.js";
import { PlatformIOError } from "../../utils/errors.js";

/** Host-resolved capabilities, never accepted verbatim as public executable or network authority. */
export interface PreparedOtaTransfer {
  projectDir: string;
  environment: string;
  target: Awaited<ReturnType<typeof resolveOtaTarget>>;
  tools: Awaited<ReturnType<typeof resolveOtaTools>>;
  image: Awaited<ReturnType<typeof retainOtaImage>>;
  filesystem: boolean;
  auth?: string;
  timeoutMs: number;
  approvalId?: string;
  commandApprovalId?: string;
  signal?: AbortSignal;
}

/** Check both grants before consuming either; runtime uncertainty retains the image and network lease. */
export async function executePreparedOtaTransfer(
  input: PreparedOtaTransfer,
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const guard = createPolicyRevisionGuard(input.projectDir);
  const operation = input.filesystem
    ? "ota_upload_filesystem"
    : "ota_upload_firmware";
  const args = {
    projectDir: input.projectDir,
    environment: input.environment,
    address: input.target.address,
    port: input.target.port,
    filesystem: input.filesystem,
    timeoutMs: input.timeoutMs,
    authenticationProvided: input.auth !== undefined,
    image: {
      path: input.image.identity.sourcePath,
      size: input.image.identity.size,
      sha256: input.image.identity.sha256,
    },
    uploader: {
      executable: input.tools.pythonExecutable,
      script: input.tools.uploaderScript,
      sha256: input.tools.uploaderSha256,
      packageName: input.tools.packageName,
      packageVersion: input.tools.packageVersion,
    },
  };
  const context = { ...caller, workspaceDir: input.projectDir };
  for (const [stage, approvalId] of [
    [operation, input.approvalId],
    ["ota_uploader_command", input.commandApprovalId],
  ] as const) {
    const plan = await planAction(stage, { ...args, approvalId }, context);
    if (plan.status !== "ready")
      throw new PlatformIOError(
        plan.reason,
        plan.status === "deny" ? "POLICY_DENIED" : "APPROVAL_REQUIRED",
        { policyDecision: plan },
      );
  }
  return dispatchAuthorizedAction(
    operation,
    { ...args, approvalId: input.approvalId },
    context,
    () =>
      dispatchAuthorizedAction(
        "ota_uploader_command",
        { ...args, approvalId: input.commandApprovalId },
        context,
        async () => {
          await onAuthorized?.();
          guard();
          await input.image.verify();
          guard();
          const custody = acquireOtaCustody(input.target);
          let cleanupPending = false;
          try {
            const result = await runEspotaProcess({
              pythonExecutable: input.tools.pythonExecutable,
              uploaderScript: input.tools.uploaderScript,
              uploaderSha256: input.tools.uploaderSha256,
              imagePath: input.image.path,
              imageSha256: input.image.identity.sha256,
              address: input.target.address,
              port: input.target.port,
              auth: input.auth,
              filesystem: input.filesystem,
              timeoutMs: input.timeoutMs,
              signal: input.signal,
              custody,
            });
            guard();
            return {
              ...result,
              imageSha256: input.image.identity.sha256,
              imageBytes: input.image.identity.size,
              address: input.target.address,
              port: input.target.port,
              runtimeVerified: false as const,
            };
          } catch (error) {
            cleanupPending =
              error instanceof PlatformIOError &&
              error.context?.cleanupPending === true;
            throw error;
          } finally {
            // Idempotent release also covers validation failures before the process takes custody.
            if (!cleanupPending) custody.releaseAfterExit();
          }
        },
      ),
  );
}
