import { uploadMatchers } from "./matchers.js";
import { diagnoseFromLog } from "./diagnose.js";

export function diagnoseUploadLog(
  logText: string,
  opts?: { taskId?: string; rawLogPath?: string; success?: boolean },
) {
  return diagnoseFromLog("upload", logText, uploadMatchers, {
    taskId: opts?.taskId,
    rawLogPath: opts?.rawLogPath,
    successOverride: opts?.success ?? false,
  });
}

