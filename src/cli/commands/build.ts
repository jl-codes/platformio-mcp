import { BuildProjectParamsSchema } from "../../types.js";
import { buildProjectCore } from "../../core/build.js";
import { asString, asBoolean } from "../args.js";
import type { CommandHandler } from "./types.js";

export const build: CommandHandler = async (ctx) => {
  const params = BuildProjectParamsSchema.parse({
    projectDir: asString(ctx.options["project-dir"]),
    environment: asString(ctx.options.environment),
    verbose: asBoolean(ctx.options.verbose),
    background: asBoolean(ctx.options.background),
  });
  return buildProjectCore(params);
};
