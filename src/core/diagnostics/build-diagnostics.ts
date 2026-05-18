import { buildMatchers } from "./matchers.js";
import { diagnoseFromLog } from "./diagnose.js";

export function diagnoseBuildLog(
  logText: string,
  opts?: { taskId?: string; rawLogPath?: string; success?: boolean },
) {
  return diagnoseFromLog("build", logText, buildMatchers, {
    taskId: opts?.taskId,
    rawLogPath: opts?.rawLogPath,
    successOverride: opts?.success ?? false,
  });
}

