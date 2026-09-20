/**
 * Authorized, bounded ESP flash reads through the shared owned-process executor.
 * The serial lease excludes monitors; uncertain process exit retains custody and private staging.
 */
import fs from "node:fs/promises";
import { createPrivateAnalysisDirectory } from "./analysis/private-analysis-directory.js";
import path from "node:path";
import { z } from "zod";
import { dispatchAuthorizedAction, planAction } from "./action-dispatcher.js";
import type { PolicyEvaluationContext } from "./policy/types.js";
import { createPolicyRevisionGuard } from "./policy/revision-guard.js";
import { resolveSerialEndpoint } from "./devices/serial-endpoint.js";
import { hardwareLockManager } from "../utils/lock-manager.js";
import { executeWithSpooling } from "../utils/spooler.js";
import { readPartitionArtifact } from "./esp-partition-artifacts.js";
import { PlatformIOError } from "../utils/errors.js";

const schema = z
  .object({
    projectDir: z.string().min(1).max(32768),
    port: z.string().min(1).max(512),
    offset: z.number().int().nonnegative().max(0xffffffff),
    length: z
      .number()
      .int()
      .positive()
      .max(16 * 1024 * 1024),
    approvalId: z.string().max(256).optional(),
    commandApprovalId: z.string().max(256).optional(),
  })
  .strict()
  .refine(
    (value) => value.offset + value.length <= 0x100000000,
    "Flash range overflows.",
  );

/** Read an explicitly approved range; package execution requires an additional host-code grant. */
export async function readEspFlash(
  input: unknown,
  caller: PolicyEvaluationContext = {},
) {
  const request = schema.parse(input);
  const projectDir = await fs.realpath(request.projectDir);
  const { commandApprovalId, ...operation } = request;
  const args = { ...operation, projectDir };
  const context = { ...caller, workspaceDir: projectDir };
  const commandArgs = { ...args, approvalId: commandApprovalId };
  for (const [name, parameters] of [
    ["esp_flash_read", args],
    ["esp_flash_read_command", commandArgs],
  ] as const) {
    const plan = await planAction(name, parameters, context);
    if (plan.status !== "ready")
      throw new PlatformIOError(
        plan.reason,
        plan.status === "requires_approval"
          ? "APPROVAL_REQUIRED"
          : "POLICY_DENIED",
        { policyDecision: plan },
      );
  }
  return dispatchAuthorizedAction("esp_flash_read", args, context, async () => {
    const guard = createPolicyRevisionGuard(projectDir);
    return dispatchAuthorizedAction(
      "esp_flash_read_command",
      commandArgs,
      context,
      async () => {
        guard();
        const endpoint = resolveSerialEndpoint(request.port);
        return hardwareLockManager.withImplicitLock(async () => {
          guard();
          endpoint.revalidate();
          const temporary = await createPrivateAnalysisDirectory();
          const output = path.join(temporary, "flash.bin");
          let retain = false;
          try {
            guard();
            endpoint.revalidate();
            const result = await executeWithSpooling(
              "pkg",
              [
                "exec",
                "--",
                "esptool.py",
                "--port",
                endpoint.canonicalPort,
                "read_flash",
                "0x" + request.offset.toString(16),
                "0x" + request.length.toString(16),
                output,
              ],
              {
                cwd: projectDir,
                projectDir,
                devicePort: endpoint.canonicalPort,
                timeout: 300000,
                background: false,
                artifactType: "debug",
              },
            );
            guard();
            if (!("exitCode" in result) || result.exitCode !== 0)
              throw new PlatformIOError(
                "ESP flash read failed; inspect the retained command log.",
                "FLASH_READ_FAILED",
                {
                  logPath: "fullLogPath" in result ? result.fullLogPath : null,
                },
              );
            const artifact = await readPartitionArtifact(
              await fs.realpath(temporary),
              output,
              request.length,
            );
            if (artifact.identity.size !== request.length)
              throw new PlatformIOError(
                "ESP flash read returned an incomplete range.",
                "FLASH_READ_INCOMPLETE",
              );
            guard();
            return {
              bytes: artifact.content,
              sha256: artifact.identity.sha256,
              port: endpoint.canonicalPort,
              offset: request.offset,
              length: request.length,
              logPath: result.fullLogPath,
            };
          } catch (error) {
            retain =
              error instanceof PlatformIOError &&
              error.context?.cleanupPending === true;
            throw error;
          } finally {
            // The exact mkdtemp child is used; no caller-selected directory is removed.
            if (!retain)
              await fs.rm(temporary, { recursive: true, force: true });
          }
        });
      },
    );
  });
}
