import {
  CheckProjectParamsSchema,
  CleanProjectParamsSchema,
  InitProjectParamsSchema,
  RunTestsParamsSchema,
} from "../../types.js";
import { initProjectCore } from "../../core/project.js";
import { getProjectConfig, getProjectContext } from "../../tools/projects.js";
import { checkProject, runTests, cleanProject } from "../../tools/build.js";
import { runTestsWithReport } from "../../core/test-report-execution.js";
import { hardwareLockManager } from "../../utils/lock-manager.js";
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

export const clean: CommandHandler = async (ctx) => {
  const params = CleanProjectParamsSchema.parse({
    projectDir: requireProjectDir(ctx),
    environment: asString(ctx.options.environment),
    full: asBoolean(ctx.options.full),
    background: asBoolean(ctx.options.background),
  });
  return hardwareLockManager.withImplicitLock(() =>
    cleanProject(params.projectDir, params.background, {
      environment: params.environment,
      full: params.full,
    }),
  );
};

/** Top-level `check` with the full static-analysis option set; `project check` stays as the short form. */
export const check: CommandHandler = async (ctx) => {
  const params = CheckProjectParamsSchema.parse({
    projectDir: requireProjectDir(ctx),
    environment: asString(ctx.options.environment),
    severity: asString(ctx.options.severity),
    pattern: asString(ctx.options.pattern),
    tool: asString(ctx.options.tool),
    skipPackages: asBoolean(ctx.options["skip-packages"]),
    structuredReport: asBoolean(ctx.options["structured-report"]),
    background: asBoolean(ctx.options.background),
  });
  return hardwareLockManager.withImplicitLock(() =>
    checkProject(params.projectDir, params.environment, params.background, {
      severity: params.severity,
      pattern: params.pattern,
      tool: params.tool,
      skipPackages: params.skipPackages,
      jsonOutput: params.structuredReport,
    }),
  );
};

export const test: CommandHandler = async (ctx) => {
  const params = RunTestsParamsSchema.parse({
    projectDir: requireProjectDir(ctx),
    environment: asString(ctx.options.environment),
    filter: asString(ctx.options.filter),
    ignore: asString(ctx.options.ignore),
    compileOnly: asBoolean(ctx.options["compile-only"]),
    withoutUploading: asBoolean(ctx.options["without-uploading"]),
    withoutBuilding: asBoolean(ctx.options["without-building"]),
    uploadPort: asString(ctx.options["upload-port"]),
    verbose: asBoolean(ctx.options.verbose),
    structuredReport: asBoolean(ctx.options["structured-report"]),
    background: asBoolean(ctx.options.background),
  });
  if (params.structuredReport && params.background) {
    throw new PlatformIOError(
      "Structured test reports require foreground execution",
      "INVALID_ARGUMENT",
      { argument: "structured-report" },
    );
  }
  const selection = {
    filter: params.filter,
    ignore: params.ignore,
    withoutUploading: params.withoutUploading,
    withoutBuilding: params.withoutBuilding,
    uploadPort: params.uploadPort,
    verbose: params.verbose,
  };
  return hardwareLockManager.withImplicitLock(() =>
    params.structuredReport
      ? runTestsWithReport(
          params.projectDir,
          params.environment,
          params.compileOnly,
          selection,
        )
      : runTests(
          params.projectDir,
          params.environment,
          params.background,
          params.compileOnly,
          selection,
        ),
  );
};
