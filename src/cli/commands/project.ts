import { InitProjectParamsSchema } from "../../types.js";
import { initProjectCore } from "../../core/project.js";
import { getProjectConfig, getProjectContext } from "../../tools/projects.js";
import { checkProject, runTests, cleanProject } from "../../tools/build.js";
import { PlatformIOError } from "../../utils/errors.js";
import { asString, asBoolean } from "../args.js";
import type { CommandContext, CommandHandler } from "./types.js";

export const init: CommandHandler = async (ctx) => {
  const params = InitProjectParamsSchema.parse({
    board: asString(ctx.options.board),
    framework: asString(ctx.options.framework),
    projectDir: asString(ctx.options["project-dir"]),
  });
  return initProjectCore(params);
};

function requireProjectDir(ctx: CommandContext): string {
  const dir = asString(ctx.options["project-dir"]);
  if (!dir) {
    throw new PlatformIOError(
      "This command requires --project-dir <dir>",
      "MISSING_ARGUMENT",
      { argument: "project-dir" },
    );
  }
  return dir;
}

export const project: CommandHandler = async (ctx) => {
  const sub = ctx.positionals[0];
  switch (sub) {
    case "check":
      return checkProject(
        requireProjectDir(ctx),
        asString(ctx.options.environment),
        asBoolean(ctx.options.background),
      );
    case "config":
      return getProjectConfig(requireProjectDir(ctx));
    case "context":
      return getProjectContext(
        requireProjectDir(ctx),
        asBoolean(ctx.options["include-build-history"]),
      );
    default:
      throw new PlatformIOError(
        `Unknown project subcommand: ${sub ?? "(none)"}. ` +
          `Expected one of: check, config, context.`,
        "UNKNOWN_SUBCOMMAND",
        { subcommand: sub },
      );
  }
};

export const clean: CommandHandler = async (ctx) =>
  cleanProject(requireProjectDir(ctx), asBoolean(ctx.options.background));

export const test: CommandHandler = async (ctx) =>
  runTests(
    requireProjectDir(ctx),
    asString(ctx.options.environment),
    asBoolean(ctx.options.background),
  );
