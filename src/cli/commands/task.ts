import {
  CheckTaskStatusParamsSchema,
  ListTaskHistoryParamsSchema,
} from "../../types.js";
import {
  checkTaskStatusSummaryCore,
  listTaskHistoryCore,
  cancelTaskCore,
} from "../../core/tasks.js";
import { PlatformIOError } from "../../utils/errors.js";
import { asString, asNumber } from "../args.js";
import type { CommandHandler } from "./types.js";

export const taskStatus: CommandHandler = async (ctx) => {
  const taskId = ctx.positionals[0];
  const params = CheckTaskStatusParamsSchema.parse({
    taskId,
    projectDir: asString(ctx.options["project-dir"]),
    logPath: asString(ctx.options["log-path"]),
  });
  return checkTaskStatusSummaryCore(params);
};

export const taskHistory: CommandHandler = async (ctx) => {
  const params = ListTaskHistoryParamsSchema.parse({
    projectDir: asString(ctx.options["project-dir"]),
    limit: asNumber(ctx.options.limit),
    status: asString(ctx.options.status),
  });
  return listTaskHistoryCore(params);
};

export const taskCancel: CommandHandler = async (ctx) => {
  const taskId = asString(ctx.options["task-id"]) ?? ctx.positionals[0];
  if (!taskId) {
    throw new PlatformIOError(
      "task-cancel requires <task-id>",
      "MISSING_ARGUMENT",
      { argument: "task-id" },
    );
  }
  return cancelTaskCore({
    taskId,
    projectDir: asString(ctx.options["project-dir"]),
  });
};
