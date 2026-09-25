import { UploadFirmwareParamsSchema } from "../../types.js";
import { uploadFirmwareCore } from "../../core/flash.js";
import { uploadFilesystem } from "../../tools/upload.js";
import { PlatformIOError } from "../../utils/errors.js";
import { asString, asBoolean, normalizePortOption } from "../args.js";
import type { CommandHandler } from "./types.js";

export const flash: CommandHandler = async (ctx) => {
  const params = UploadFirmwareParamsSchema.parse({
    projectDir: asString(ctx.options["project-dir"]),
    port: normalizePortOption(asString(ctx.options.port)),
    environment: asString(ctx.options.environment),
    verbose: asBoolean(ctx.options.verbose),
    background: asBoolean(ctx.options.background),
    start_monitor: asBoolean(ctx.options["start-monitor"]),
  });
  return uploadFirmwareCore({
    projectDir: params.projectDir,
    port: params.port,
    environment: params.environment,
    verbose: params.verbose,
    background: params.background,
    startMonitorAfter: asBoolean(ctx.options["start-monitor"]),
  });
};

export const uploadFs: CommandHandler = async (ctx) => {
  const projectDir = asString(ctx.options["project-dir"]);
  if (!projectDir) {
    throw new PlatformIOError(
      "upload-fs requires --project-dir <dir>",
      "MISSING_ARGUMENT",
      { argument: "project-dir" },
    );
  }
  return uploadFilesystem(
    projectDir,
    asString(ctx.options.port),
    asString(ctx.options.environment),
    asBoolean(ctx.options.verbose),
    asBoolean(ctx.options.background),
    asBoolean(ctx.options["start-monitor"]),
  );
};
