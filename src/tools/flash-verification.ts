/** Compose authorized upload and fresh owned boot capture for an already resolved project/environment. */
import { z } from "zod";
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
) {
  const args = FlashVerificationSchema.parse(input);
  await validateVerificationCapture(args.verification);
  const guard = createPolicyRevisionGuard(args.projectDir);
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
      ),
  );
  guard();
  const started = performance.now();
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
      await client.run({ caller }, async (service, owner) => {
        const held = service.sessions
          .list(owner)
          .filter(
            (session) =>
              (!["stopped", "disconnected", "error"].includes(session.state) ||
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
          const stopped = await service.sessions.stop(owner, session.sessionId);
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
  );
  guard();
  const uploadSeconds = (performance.now() - started) / 1000;
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
  const report = await client.run(
    { ...context, discoveryApprovalId: args.discoveryApprovalId },
    (service, owner) =>
      service.captureVerificationOnce(
        owner,
        request,
        args.verification,
        undefined,
        selection.deviceBinding,
      ),
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
}
