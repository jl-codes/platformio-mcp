/** Reference flash-and-verify parameters over the shared upload, fresh capture and crash-decoding workflows. */
import { planAction } from "../core/action-dispatcher.js";
import { z } from "zod";
import { executeFlashVerification } from "../tools/flash-verification.js";
import { VerificationCaptureSchema } from "../core/serial/verification-capture.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { PlatformIOError } from "../utils/errors.js";
import { SerialClientContext } from "./serial-client.js";
import {
  resolveCompatibilityProject,
  type CompatibilityProjectDefaults,
} from "./compatibility-project.js";
import { resolveMonitorRequest } from "./monitor-start-compat.js";
import { projectCompatibilityDevices } from "./device-compat.js";
import { executeDecodeCompatibility } from "./decode-compat.js";

/** Pinned reference defaults with bounded capture and separate grants for each effect. */
export const FlashVerificationCompatibilitySchema = z
  .object({
    project_dir: z.string().min(1).max(32768).nullish(),
    env: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,50}$/)
      .nullish(),
    expect: VerificationCaptureSchema.shape.expect,
    fail_on: z
      .string()
      .max(4096)
      .default(
        "Guru Meditation|panic'ed|abort\\(\\) was called|assert failed|HardFault|Hard Fault|BusFault|UsageFault|MemManage|stack overflow|Task watchdog|Brownout|CORRUPT HEAP|Backtrace:|rst:0x[0-9a-f]+ \\((?:SW_CPU_RESET|TG\\dWDT_SYS_RESET|RTCWDT_RTC_RESET|PANIC)",
      ),
    timeout_s: z.number().finite().min(0).max(300).default(30),
    upload_port: z.string().min(1).max(512).nullish(),
    monitor_port: z.string().min(1).max(512).nullish(),
    baud: z.number().int().min(1).max(4000000).nullish(),
    stop_open_sessions: z.boolean().default(false),
    max_lines: z.number().int().min(1).max(10000).default(500),
    settle_s: z.number().finite().min(0).max(20).default(1.5),
    stability_window_s: z.number().finite().min(0).max(60).default(10),
    resume_id: z.string().uuid().optional(),
    manifest_approval_id: z.string().max(256).optional(),
    system_approval_id: z.string().max(256).optional(),
    workflow_approval_id: z.string().max(256).optional(),
    approval_id: z.string().max(256).optional(),
    config_approval_id: z.string().max(256).optional(),
    selection_approval_id: z.string().max(256).optional(),
    monitor_approval_id: z.string().max(256).optional(),
    read_approval_id: z.string().max(256).optional(),
    preflight_discovery_approval_id: z.string().max(256).optional(),
    discovery_approval_id: z.string().max(256).optional(),
    decode_approval_id: z.string().max(256).optional(),
    decode_config_approval_id: z.string().max(256).optional(),
  })
  .strict();

/** Resolve one concrete environment and ports, then decode failures without converting them to success. */
export async function executeFlashVerificationCompatibility(
  input: unknown,
  client: SerialClientContext,
  defaults: CompatibilityProjectDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const parsed = FlashVerificationCompatibilitySchema.safeParse(input);
  if (!parsed.success)
    throw new PlatformIOError(
      "Invalid flash verification arguments.",
      "COMPAT_ARGUMENT_INVALID",
    );
  const args = parsed.data;
  const projectDir = await resolveCompatibilityProject(
    args.project_dir,
    defaults,
  );
  const guard = createPolicyRevisionGuard(projectDir);
  const permission = await planAction(
    "flash_verification",
    { projectDir },
    { ...caller, workspaceDir: projectDir },
  );
  if (permission.status === "deny")
    throw new PlatformIOError(permission.reason, "POLICY_DENIED");
  guard();
  const resolved = await resolveMonitorRequest(
    {
      project_dir: projectDir,
      env: args.env,
      port: args.monitor_port || args.upload_port,
      baud: args.baud,
      config_approval_id: args.config_approval_id,
      selection_approval_id: args.selection_approval_id,
    },
    defaults,
    caller,
    projectCompatibilityDevices,
  );
  if (!resolved.environment)
    throw new PlatformIOError(
      "Select one flash verification environment explicitly.",
      "PROJECT_ENVIRONMENT_INVALID",
    );
  guard();
  const report = await executeFlashVerification(
    {
      projectDir,
      environment: resolved.environment,
      uploadPort: args.upload_port || resolved.request.path,
      monitorPort: resolved.request.path,
      baudRate: resolved.request.baudRate,
      stopOpenSessions: args.stop_open_sessions,
      retainFirmware:
        Boolean(args.resume_id) ||
        ((resolved.uploadSelection?.protocol == null ||
          resolved.uploadSelection.protocol === "" ||
          resolved.uploadSelection.protocol === "esptool") &&
          (resolved.uploadSelection?.protocol === "esptool" ||
            (typeof resolved.uploadSelection?.platform === "string" &&
              /^(?:platformio\/)?espressif(?:32|8266)(?:@|$)/.test(
                resolved.uploadSelection.platform,
              )))),
      resumeId: args.resume_id,
      manifestApprovalId: args.manifest_approval_id,
      systemApprovalId: args.system_approval_id,
      verification: {
        expect: args.expect,
        failOn: args.fail_on,
        timeoutSeconds: args.timeout_s,
        settleSeconds: args.settle_s * 1.5,
        stabilityWindowSeconds: args.stability_window_s,
        maxLines: args.max_lines,
      },
      workflowApprovalId: args.workflow_approval_id,
      uploadApprovalId: args.approval_id,
      openApprovalId: args.monitor_approval_id,
      readApprovalId: args.read_approval_id,
      preflightDiscoveryApprovalId: args.preflight_discovery_approval_id,
      discoveryApprovalId: args.discovery_approval_id,
    },
    client,
    caller,
    onAuthorized,
  );
  guard();
  if (report.verdict !== "fail" || !("lines" in report)) return report;
  let decoded: unknown;
  try {
    decoded = await executeDecodeCompatibility(
      client,
      {
        project_dir: projectDir,
        env: resolved.environment,
        text: report.lines.join("\n"),
        ...("upload_manifest" in report && report.upload_manifest
          ? {
              archived_elf_sha256: report.upload_manifest.elf.sha256,
              expected_elf_sha256: report.upload_manifest.elf.sha256,
            }
          : {}),
        approval_id: args.decode_approval_id,
        config_approval_id: args.decode_config_approval_id,
      },
      defaults,
      caller,
    );
  } catch (error) {
    decoded = {
      ok: false,
      error:
        error instanceof PlatformIOError
          ? error.code
          : "CRASH_DECODE_UNAVAILABLE",
      summary:
        "Boot failure was captured; crash decoding is unavailable or requires separate permission.",
    };
  }
  guard();
  return { ...report, decoded };
}
