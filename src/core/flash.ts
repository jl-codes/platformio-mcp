/**
 * Core firmware flashing orchestrator.
 *
 * Provides:
 * - uploadFirmwareCore: Coordinates write-target resolution, hardware locking, and flashing.
 */

import { uploadFirmware } from "../tools/upload.js";
import type { UploadResult } from "../types.js";
import { hardwareLockManager } from "../utils/lock-manager.js";
import { loadEffectivePolicyState } from "./policy/load-policy.js";
import { resolveWriteTarget, type TargetBinding } from "./target-resolution.js";

export type UploadFirmwareCoreInput = {
  projectDir: string;
  port?: string;
  environment?: string;
  verbose?: boolean;
  background?: boolean;
  startMonitorAfter?: boolean;
  sessionId?: string;
  targetBinding?: TargetBinding;
  maxRunDurationSeconds?: number;
};

/**
 * Resolves the write target, manages lock custody, and executes firmware upload.
 *
 * @param input - Upload configuration including project directory, optional port, and environment.
 * @returns Upload result.
 */
export async function uploadFirmwareCore(
  input: UploadFirmwareCoreInput,
): Promise<UploadResult> {
  let target: { port: string; environment: string };
  const policyState = await loadEffectivePolicyState(input.projectDir);
  if (
    policyState.profile === "standalone" &&
    input.environment?.trim() &&
    input.port?.trim()
  ) {
    // Standalone mode: trust explicit env+port, skip target resolution ceremony
    target = { port: input.port.trim(), environment: input.environment.trim() };
  } else {
    target = await resolveWriteTarget(input);
  }

  const executeTask = () =>
    uploadFirmware(
      input.projectDir,
      target.port,
      target.environment,
      input.verbose,
      input.background,
      input.startMonitorAfter,
      input.maxRunDurationSeconds,
    );

  if (input.sessionId) {
    hardwareLockManager.requireLock(input.sessionId);
    return executeTask();
  }

  return hardwareLockManager.withImplicitLock(executeTask);
}
