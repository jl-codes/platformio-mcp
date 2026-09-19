import { queryLogs, captureSerialWindow } from "../../tools/monitor.js";
import { PlatformIOError } from "../../utils/errors.js";
import { asString, parseNumberOption } from "../args.js";
import type { CommandHandler } from "./types.js";

export const logs: CommandHandler = async (ctx) => {
  const sub = ctx.positionals[0];
  const projectDir = asString(ctx.options["project-dir"]);

  switch (sub) {
    case "query":
      return queryLogs(
        parseNumberOption(ctx.options.lines, "lines") ?? 100,
        asString(ctx.options.search),
        asString(ctx.options["task-id"]),
        asString(ctx.options["log-path"]),
        projectDir,
        asString(ctx.options.port),
      );
    case "capture": {
      if (!projectDir) {
        throw new PlatformIOError(
          "logs capture requires --project-dir <dir>",
          "MISSING_ARGUMENT",
          { argument: "project-dir" },
        );
      }
      return captureSerialWindow({
        projectDir,
        port: asString(ctx.options.port),
        environment: asString(ctx.options.environment),
        baudRate: parseNumberOption(ctx.options["baud-rate"], "baud-rate"),
        durationSeconds: parseNumberOption(ctx.options.duration, "duration"),
        maxBytes: parseNumberOption(ctx.options["max-bytes"], "max-bytes"),
        cursor: asString(ctx.options.cursor),
      });
    }
    default:
      throw new PlatformIOError(
        `Unknown logs subcommand: ${sub ?? "(none)"}. ` +
          `Expected one of: query, capture.`,
        "UNKNOWN_SUBCOMMAND",
        { subcommand: sub },
      );
  }
};
