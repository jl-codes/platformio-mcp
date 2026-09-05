import { uploadFirmware } from "../tools/upload.js";
import type { UploadResult } from "../types.js";
import { hardwareLockManager } from "../utils/lock-manager.js";
import {
  resolveWriteTarget,
  type TargetBinding,
} from "./target-resolution.js";

export type UploadFirmwareCoreInput = {
  projectDir: string;
  port?: string;
  environment?: string;
  verbose?: boolean;
  background?: boolean;
  startMonitorAfter?: boolean;
  sessionId?: string;
  targetBinding?: TargetBinding;
};

export async function uploadFirmwareCore(
  input: UploadFirmwareCoreInput,
): Promise<UploadResult> {
  const target = await resolveWriteTarget(input);

  const executeTask = () =>
    uploadFirmware(
      input.projectDir,
      target.port,
      target.environment,
      input.verbose,
      input.background,
      input.startMonitorAfter,
    );

  if (input.sessionId) {
    hardwareLockManager.requireLock(input.sessionId);
    return executeTask();
  }

  return hardwareLockManager.withImplicitLock(executeTask);
}
