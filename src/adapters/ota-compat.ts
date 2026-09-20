/** Reference OTA vocabulary over the shared authorized build/snapshot/network-transfer service. */
import { z } from "zod";
import { executeOtaUpload } from "../tools/ota.js";
import { PlatformIOError } from "../utils/errors.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import {
  resolveCompatibilityProject,
  type CompatibilityProjectDefaults,
} from "./compatibility-project.js";
/** Reference fields plus scoped permission and exact-image extensions. */
export const OtaCompatibilitySchema = z
  .object({
    host: z.string().min(1).max(253),
    project_dir: z.string().min(1).max(32768).nullish(),
    env: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,50}$/)
      .nullish(),
    port: z.number().int().min(1).max(65535).nullish(),
    auth: z
      .string()
      .max(1024)
      .regex(/^[^\x00-\x1f\x7f]*$/)
      .nullish(),
    filesystem: z.boolean().default(false),
    build: z.boolean().default(true),
    timeout_s: z.number().finite().min(0.001).max(600).default(180),
    verify_reachable: z.boolean().default(true),
    image_path: z.string().min(1).max(32768).optional(),
    expected_image_sha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
    approval_id: z.string().max(256).optional(),
    command_approval_id: z.string().max(256).optional(),
    config_approval_id: z.string().max(256).optional(),
    build_approval_id: z.string().max(256).optional(),
    image_approval_id: z.string().max(256).optional(),
    system_approval_id: z.string().max(256).optional(),
    resolve_approval_id: z.string().max(256).optional(),
  })
  .strict();
/** Never forward arbitrary uploader arguments or caller-selected executable trust. */
export async function executeOtaCompatibility(
  input: unknown,
  defaults: CompatibilityProjectDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const parsed = OtaCompatibilitySchema.safeParse(input);
  if (!parsed.success)
    throw new PlatformIOError(
      "Invalid OTA compatibility arguments.",
      "COMPAT_ARGUMENT_INVALID",
    );
  const args = parsed.data;
  return executeOtaUpload(
    {
      projectDir: await resolveCompatibilityProject(args.project_dir, defaults),
      host: args.host.trim(),
      environment: args.env ?? undefined,
      port: args.port ?? undefined,
      auth: args.auth ?? undefined,
      filesystem: args.filesystem,
      build: args.build,
      timeoutSeconds: args.timeout_s,
      verifyReachable: args.verify_reachable,
      imagePath: args.image_path,
      expectedImageSha256: args.expected_image_sha256,
      approvalId: args.approval_id,
      commandApprovalId: args.command_approval_id,
      configApprovalId: args.config_approval_id,
      buildApprovalId: args.build_approval_id,
      imageApprovalId: args.image_approval_id,
      systemApprovalId: args.system_approval_id,
      resolveApprovalId: args.resolve_approval_id,
    },
    caller,
    onAuthorized,
  );
}
