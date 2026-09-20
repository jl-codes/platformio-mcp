/** Compose authorized upload and fresh owned boot capture for an already resolved project/environment. */
import type { PolicySerialSessionService } from "../core/serial/session-policy.js";
import { z } from "zod";
import {
  dispatchAuthorizedAction,
  planAction,
} from "../core/action-dispatcher.js";
import { SerialClientContext } from "../adapters/serial-client.js";
import { executeUploadCompatibility } from "../adapters/upload-compat.js";
import {
  VerificationCaptureSchema,
  validateVerificationCapture,
} from "../core/serial/verification-capture.js";
import { resolveSerialEndpoint } from "../core/devices/serial-endpoint.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { PlatformIOError } from "../utils/errors.js";

/** Internal resolved inputs; reference/default selection happens before this execution boundary. */
export const FlashVerificationSchema = z
  .object({
    projectDir: z.string().min(1).max(32768),
    environment: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),
    uploadPort: z.string().min(1).max(512),
    monitorPort: z.string().min(1).max(512),
    baudRate: z.number().int().min(1).max(4000000),
    stopOpenSessions: z.boolean().default(false),
    verification: VerificationCaptureSchema.default({}),
    workflowApprovalId: z.string().max(256).optional(),
    uploadApprovalId: z.string().max(256).optional(),
    openApprovalId: z.string().max(256).optional(),
    readApprovalId: z.string().max(256).optional(),
    preflightDiscoveryApprovalId: z.string().max(256).optional(),
    discoveryApprovalId: z.string().max(256).optional(),
  })
  .strict();

/** Preflight monitor permissions before flashing, then close only this connection's selected monitor if authorized. */
export async function executeFlashVerification(
  input: z.input<typeof FlashVerificationSchema>,
  client: SerialClientContext,
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const args = FlashVerificationSchema.parse(input);
  await validateVerificationCapture(args.verification);
  const guard = createPolicyRevisionGuard(args.projectDir);
  const workflowArgs = {
    projectDir: args.projectDir,
    environment: args.environment,
    uploadPort: args.uploadPort,
    monitorPort: args.monitorPort,
    baudRate: args.baudRate,
    stopOpenSessions: args.stopOpenSessions,
    verification: args.verification,
    approvalId: args.workflowApprovalId,
  };
  const workflowContext = { ...caller, workspaceDir: args.projectDir };
  const permission = await planAction(
    "flash_verification",
    workflowArgs,
    workflowContext,
  );
  if (permission.status !== "ready")
    throw new PlatformIOError(
      permission.reason,
      permission.status === "deny" ? "POLICY_DENIED" : "APPROVAL_REQUIRED",
      { policyDecision: permission },
    );
  const monitorEndpoint = resolveSerialEndpoint(args.monitorPort);
  const request = {
    projectDir: args.projectDir,
    path: args.monitorPort,
    baudRate: args.baudRate,
  };
  const context = {
    caller,
    approvalId: args.openApprovalId,
    readApprovalId: args.readApprovalId,
  };
  const selection = await client.run(
    { ...context, discoveryApprovalId: args.preflightDiscoveryApprovalId },
    (service, owner) =>
      service.preflightVerificationCapture(
        owner,
        request,
        args.verification,
        args.discoveryApprovalId,
        true,
      ),
  );
  guard();
  return dispatchAuthorizedAction(
    "flash_verification",
    workflowArgs,
    workflowContext,
    async () => {
      guard();
      let uploadSeconds = 0;
      let report:
        | Awaited<
            ReturnType<PolicySerialSessionService["captureVerificationOnce"]>
          >
        | undefined;
      const upload = await executeUploadCompatibility(
        {
          project_dir: args.projectDir,
          env: args.environment,
          upload_port: args.uploadPort,
          stop_open_sessions: args.stopOpenSessions,
          approval_id: args.uploadApprovalId,
        },
        client,
        {},
        caller,
        async () => {
          // Called only inside canonical upload authorization, before any upload effect.
          await onAuthorized?.();
          guard();
          await client.run({ caller }, async (service, owner) => {
            const held = service.sessions
              .list(owner)
              .filter(
                (session) =>
                  (!["stopped", "disconnected", "error"].includes(
                    session.state,
                  ) ||
                    session.cleanupPending) &&
                  resolveSerialEndpoint(session.path).resource.identity ===
                    monitorEndpoint.resource.identity,
              );
            if (held.length && !args.stopOpenSessions)
              throw new PlatformIOError(
                "An owned monitor holds the verification port.",
                "TARGET_PORT_BUSY",
              );
            for (const session of held) {
              guard();
              const stopped = await service.sessions.stop(
                owner,
                session.sessionId,
              );
              if (stopped.cleanupPending)
                throw new PlatformIOError(
                  "Verification monitor closure is unconfirmed.",
                  "DEVICE_CLEANUP_PENDING",
                  { cleanupPending: true },
                );
            }
          });
          guard();
        },
        undefined,
        async (runUpload) => {
          try {
            report = await client.run(
              { ...context, discoveryApprovalId: args.discoveryApprovalId },
              (service, owner) =>
                service.captureVerificationOnce(
                  owner,
                  request,
                  args.verification,
                  undefined,
                  selection.deviceBinding,
                  async (held) => {
                    guard();
                    const started = performance.now();
                    let ok: boolean;
                    try {
                      const sameEndpoint =
                        resolveSerialEndpoint(args.uploadPort).resource
                          .identity === monitorEndpoint.resource.identity;
                      ok = await runUpload(
                        sameEndpoint
                          ? { ...held, path: args.monitorPort }
                          : undefined,
                      );
                    } finally {
                      uploadSeconds = (performance.now() - started) / 1000;
                    }
                    guard();
                    if (!ok)
                      throw new PlatformIOError(
                        "Upload failed; do not open the verification monitor.",
                        "VERIFICATION_UPLOAD_FAILED",
                      );
                  },
                ),
            );
          } catch (error) {
            // A failed upload has its own report; never hide an uncertain reservation cleanup.
            if (
              !(error instanceof PlatformIOError) ||
              error.code !== "VERIFICATION_UPLOAD_FAILED" ||
              error.context?.cleanupPending !== false
            )
              throw error;
          }
        },
      );
      guard();
      if (!upload.ok)
        return {
          ok: false,
          verdict: "upload_failed" as const,
          upload,
          upload_s: uploadSeconds,
          port: selection.port,
          baud: args.baudRate,
          summary: "Upload failed; boot verification did not start.",
        };
      if (!report)
        throw new PlatformIOError(
          "Boot verification returned no report.",
          "VERIFICATION_RESULT_MISSING",
        );
      guard();
      return {
        ...report,
        upload,
        upload_s: uploadSeconds,
        firmware_identity: "identity_unverified" as const,
        summary:
          report.verdict === "pass"
            ? "Upload succeeded and fresh boot output passed verification."
            : `Upload succeeded; boot verification returned ${report.verdict}.`,
      };
    },
  );
}
