import { serialMatchers } from "./matchers.js";
import { diagnoseFromLog } from "./diagnose.js";

export function diagnoseSerialLog(
  logText: string,
  opts?: { taskId?: string; rawLogPath?: string; success?: boolean },
) {
  return diagnoseFromLog("monitor", logText, serialMatchers, {
    taskId: opts?.taskId,
    rawLogPath: opts?.rawLogPath,
    successOverride: opts?.success ?? false,
  });
}

