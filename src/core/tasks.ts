import { checkTaskStatus } from "../tools/build.js";
import { getCommandHistory } from "../utils/command-registry.js";

export type TaskStatusCoreInput = {
  taskId?: string;
  logPath?: string;
  projectDir?: string;
};

export async function checkTaskStatusCore(input: TaskStatusCoreInput) {
  return checkTaskStatus(input.taskId, input.logPath, input.projectDir);
}

export async function checkTaskStatusSummaryCore(input: TaskStatusCoreInput) {
  const raw = await checkTaskStatus(input.taskId, input.logPath, input.projectDir);
  const commandId = raw.taskId;
  const history = getCommandHistory(input.projectDir);
  const cmd = commandId ? history.find((item) => item.id === commandId) : undefined;
  const firstTask = cmd?.tasks?.[0];

  return {
    taskId: commandId,
    status: raw.targetStatus,
    type: firstTask?.type ?? "unknown",
    logPath: raw.logPaths?.[0],
    logPaths: raw.logPaths ?? [],
    output: raw.output,
    raw,
  };
}
