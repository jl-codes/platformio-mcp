/** Authorized ESP OTA build, immutable image capture, fixed network selection and protocol reporting. */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { platformioExecutor } from "../platformio.js";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { selectOtaConfiguration } from "../core/ota/ota-configuration.js";
import { resolveOtaTools } from "../core/ota/ota-tools.js";
import { resolveOtaTarget } from "../core/devices/ota-target.js";
import { retainOtaImage } from "../core/ota/ota-artifacts.js";
import { executePreparedOtaTransfer } from "../core/ota/ota-transfer.js";
import { summarizeOtaTransfer } from "../core/ota/ota-report.js";
import { hardwareLockManager } from "../utils/lock-manager.js";
import { retainCommandLog } from "../utils/command-log.js";
import { PlatformIOError } from "../utils/errors.js";
import { buildTarget } from "./build.js";
import { getSystemInfo } from "./projects.js";

/** Public canonical request: host tool paths and resolved identities are deliberately absent. */
export const OtaUploadSchema = z
  .object({
    projectDir: z.string().min(1).max(32768),
    host: z.string().min(1).max(253),
    environment: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,50}$/)
      .optional(),
    port: z.number().int().min(1).max(65535).optional(),
    auth: z
      .string()
      .max(1024)
      .regex(/^[^\x00-\x1f\x7f]*$/)
      .optional(),
    filesystem: z.boolean().default(false),
    build: z.boolean().default(true),
    timeoutSeconds: z.number().finite().min(0.001).max(600).default(180),
    verifyReachable: z.boolean().default(true),
    imagePath: z.string().min(1).max(32768).optional(),
    expectedImageSha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
    approvalId: z.string().max(256).optional(),
    commandApprovalId: z.string().max(256).optional(),
    configApprovalId: z.string().max(256).optional(),
    buildApprovalId: z.string().max(256).optional(),
    imageApprovalId: z.string().max(256).optional(),
    systemApprovalId: z.string().max(256).optional(),
    resolveApprovalId: z.string().max(256).optional(),
  })
  .strict();

/** Build without uploading, freeze the chosen image, then transfer those exact bytes through the registered uploader. */
export async function executeOtaUpload(
  input: unknown,
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const parsed = OtaUploadSchema.safeParse(input);
  if (!parsed.success)
    throw new PlatformIOError(
      "Invalid OTA upload arguments.",
      "OTA_ARGUMENT_INVALID",
    );
  const args = parsed.data,
    projectDir = await fs.realpath(args.projectDir);
  const context = { ...caller, workspaceDir: projectDir },
    guard = createPolicyRevisionGuard(projectDir);
  const configuration = await dispatchAuthorizedAction(
    "get_project_config",
    {
      projectDir,
      purpose: "ota_configuration",
      approvalId: args.configApprovalId,
    },
    context,
    async () => {
      const result = await platformioExecutor.execute(
        "project",
        ["config", "--json-output"],
        { cwd: projectDir, timeout: 30000 },
      );
      guard();
      if (result.exitCode !== 0)
        throw new PlatformIOError(
          "Cannot resolve OTA project configuration.",
          "OTA_CONFIG_INVALID",
        );
      return selectOtaConfiguration(
        result.stdout,
        projectDir,
        args.environment,
      );
    },
  );
  if (configuration.otherFlags.length)
    throw new PlatformIOError(
      "Additional configured OTA upload flags require supported explicit mapping.",
      "OTA_FLAGS_UNSUPPORTED",
    );
  const auth = args.auth ?? configuration.auth;
  const target = await dispatchAuthorizedAction(
    "list_devices",
    {
      projectDir,
      purpose: "ota_resolution",
      host: args.host,
      port: args.port ?? configuration.configuredPort,
      approvalId: args.resolveApprovalId,
    },
    context,
    () =>
      resolveOtaTarget(args.host, args.port ?? configuration.configuredPort),
  );
  guard();
  const started = performance.now();
  return hardwareLockManager.withImplicitLock(async () => {
    guard();
    let buildResult: Awaited<ReturnType<typeof buildTarget>> | undefined;
    if (args.build)
      buildResult = await dispatchAuthorizedAction(
        "target_build",
        {
          projectDir,
          environment: configuration.environment,
          target: args.filesystem ? "buildfs" : "buildprog",
          purpose: "ota_image",
          approvalId: args.buildApprovalId,
        },
        context,
        async () => {
          await onAuthorized?.();
          guard();
          return buildTarget(
            projectDir,
            args.filesystem ? "buildfs" : "buildprog",
            configuration.environment,
            false,
          );
        },
      );
    guard();
    if (buildResult && !buildResult.success)
      return {
        ok: false,
        error: "build_failed",
        summary: "Build failed before OTA transfer.",
        build: buildResult,
        host: args.host,
        env: configuration.environment,
        runtime_verified: false,
      };
    const tools = await dispatchAuthorizedAction(
      "system_info",
      { projectDir, purpose: "ota_tools", approvalId: args.systemApprovalId },
      context,
      async () => {
        const info = await getSystemInfo();
        guard();
        return resolveOtaTools(projectDir, configuration.family, info);
      },
    );
    guard();
    const image = await dispatchAuthorizedAction(
      "get_project_config",
      {
        projectDir,
        environment: configuration.environment,
        purpose: "ota_image",
        imagePath: args.imagePath ?? null,
        filesystem: args.filesystem,
        expectedImageSha256: args.expectedImageSha256,
        approvalId: args.imageApprovalId,
      },
      context,
      async () => {
        let selected = args.imagePath;
        if (!selected && !args.filesystem)
          selected = path.join(configuration.buildDirectory, "firmware.bin");
        if (!selected && configuration.filesystemImage)
          selected = path.join(
            configuration.buildDirectory,
            configuration.filesystemImage,
          );
        if (!selected) {
          const candidates: string[] = [];
          for (const name of ["spiffs.bin", "littlefs.bin", "fatfs.bin"]) {
            const candidate = path.join(configuration.buildDirectory, name);
            try {
              if ((await fs.stat(candidate)).isFile())
                candidates.push(candidate);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            }
          }
          if (candidates.length !== 1)
            throw new PlatformIOError(
              "Select one existing filesystem image explicitly.",
              "OTA_IMAGE_AMBIGUOUS",
            );
          selected = candidates[0];
        }
        guard();
        return retainOtaImage(projectDir, selected, args.expectedImageSha256);
      },
    );
    let cleanupPending = false;
    try {
      const result = await executePreparedOtaTransfer(
        {
          projectDir,
          environment: configuration.environment,
          target,
          tools,
          image,
          filesystem: args.filesystem,
          auth,
          timeoutMs: Math.ceil(args.timeoutSeconds * 1000),
          approvalId: args.approvalId,
          commandApprovalId: args.commandApprovalId,
        },
        context,
        args.build ? undefined : onAuthorized,
      );
      guard();
      const output = result.stdout + "\n" + result.stderr;
      const report = summarizeOtaTransfer(output, result.exitCode);
      const logPath = await retainCommandLog(
        "target",
        result.stdout,
        result.stderr,
      );
      guard();
      return {
        ...report,
        summary: report.ok
          ? "OTA image transfer completed; runtime health requires separate observation."
          : `OTA upload failed (${report.error}). ${report.hint}`,
        host: args.host,
        target_host: target.address,
        port: target.port,
        env: configuration.environment,
        platform_family: configuration.family,
        filesystem: args.filesystem,
        upload_path: args.build ? "pio_build_espota_direct" : "espota_direct",
        firmware_path: image.identity.sourcePath,
        firmware_bytes: image.identity.size,
        firmware_sha256: image.identity.sha256,
        reachable: null,
        reachability_status: args.verifyReachable
          ? "icmp_not_probed"
          : "not_requested",
        duration_s: (performance.now() - started) / 1000,
        exit_code: result.exitCode,
        log_path: logPath,
        output_tail: output.slice(-16000),
        build: buildResult ?? null,
      };
    } catch (error) {
      cleanupPending =
        error instanceof PlatformIOError &&
        error.context?.cleanupPending === true;
      throw error;
    } finally {
      if (!cleanupPending) await image.release();
    }
  });
}
