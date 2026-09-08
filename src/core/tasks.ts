import { checkTaskStatus } from "../tools/build.js";
import {
  findCommandAcrossWorkspaces,
  getCommandHistory,
  updateTaskStatus,
} from "../utils/command-registry.js";
import type {
  CommandRecord,
  TaskRecord,
} from "../utils/command-registry.js";
import {
  killTrackedTaskProcess,
  sweepGhostTasks,
} from "../utils/process-manager.js";
import { stopMonitor } from "../tools/monitor.js";
import { PlatformIOError } from "../utils/errors.js";

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

/** Compact task history item returned to MCP clients. */
export interface TaskHistoryItem {
  commandId: string;
  taskId: string;
  type: TaskRecord["type"];
  status: TaskRecord["status"];
  startedAt: string;
  port?: string;
  exitCode?: number;
  logPaths: string[];
  error?: string;
}

/**
 * Returns recent project-scoped task records after reconciling stale PIDs.
 *
 * @param input - Project scope, result limit, and optional status filter.
 * @returns Newest-first compact task history.
 */
export async function listTaskHistoryCore(input: {
  projectDir: string;
  limit?: number;
  status?: TaskRecord["status"];
}): Promise<{ tasks: TaskHistoryItem[]; observedAt: string }> {
  await sweepGhostTasks(input.projectDir);
  const tasks = getCommandHistory(input.projectDir)
    .flatMap((command) =>
      command.tasks.map((task) => ({
        commandId: command.id,
        taskId: task.taskId,
        type: task.type,
        status: task.status,
        startedAt: new Date(command.timestamp).toISOString(),
        port: task.port,
        exitCode: task.exitCode,
        logPaths: task.logPaths ?? [],
        error: task.error,
      })),
    )
    .filter((task) => !input.status || task.status === input.status)
    .sort(
      (left, right) =>
        new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime(),
    )
    .slice(0, Math.min(100, Math.max(1, input.limit ?? 20)));
  return { tasks, observedAt: new Date().toISOString() };
}

/**
 * Resolves a command and one exact nested task across known workspaces.
 *
 * @param taskId - Command or nested task identifier.
 * @param projectDir - Optional project scope.
 * @returns Owning command, task, and resolved workspace.
 */
async function resolveTask(
  taskId: string,
  projectDir?: string,
): Promise<{
  command: CommandRecord;
  task: TaskRecord;
  projectDir?: string;
} | null> {
  let command: CommandRecord | undefined;
  let resolvedProjectDir = projectDir;
  if (projectDir) {
    command = getCommandHistory(projectDir).find(
      (item) =>
        item.id === taskId || item.tasks.some((task) => task.taskId === taskId),
    );
  } else {
    const found = await findCommandAcrossWorkspaces(taskId);
    command = found?.command;
    resolvedProjectDir = found?.projectDir;
  }
  if (!command) return null;

  const directTask = command.tasks.find((task) => task.taskId === taskId);
  if (directTask) {
    return { command, task: directTask, projectDir: resolvedProjectDir };
  }
  const running = command.tasks.filter((task) => task.status === "running");
  if (running.length !== 1) {
    throw new PlatformIOError(
      `Command ${command.id} does not identify exactly one running task.`,
      "AMBIGUOUS_TASK",
    );
  }
  return { command, task: running[0], projectDir: resolvedProjectDir };
}

/**
 * Idempotently cancels one owned background task and releases its resources.
 *
 * @param input - Task identifier and optional project scope.
 * @returns Cancellation outcome.
 */
export async function cancelTaskCore(input: {
  taskId: string;
  projectDir?: string;
}): Promise<{
  success: boolean;
  taskId: string;
  status: "cancelled" | "already_terminal" | "not_found";
  processTerminated: boolean;
}> {
  const resolved = await resolveTask(input.taskId, input.projectDir);
  if (!resolved) {
    return {
      success: false,
      taskId: input.taskId,
      status: "not_found",
      processTerminated: false,
    };
  }
  if (resolved.task.status !== "running") {
    return {
      success: true,
      taskId: resolved.task.taskId,
      status: "already_terminal",
      processTerminated: false,
    };
  }

  await updateTaskStatus(
    resolved.command.id,
    resolved.task.taskId,
    { status: "terminated", error: "Cancelled by MCP request." },
    resolved.projectDir,
  );

  let processTerminated = false;
  if (resolved.task.type === "monitor" && resolved.task.port) {
    await stopMonitor(resolved.task.port, resolved.projectDir);
    processTerminated = Boolean(resolved.task.pid);
  } else {
    processTerminated = await killTrackedTaskProcess(
      resolved.task,
      resolved.projectDir,
    );
  }

  return {
    success: true,
    taskId: resolved.task.taskId,
    status: "cancelled",
    processTerminated,
  };
}
