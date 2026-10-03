import {
  searchLibraries,
  installLibrary,
  listInstalledLibraries,
  uninstallLibrary,
  updateLibrary,
} from "../../tools/libraries.js";
import { PlatformIOError } from "../../utils/errors.js";
import { asString, parseNumberOption } from "../args.js";
import type { CommandContext, CommandHandler } from "./types.js";

function requireArg(ctx: CommandContext, index: number, name: string): string {
  const value = ctx.positionals[index];
  if (!value) {
    throw new PlatformIOError(
      `lib ${ctx.positionals[0]} requires <${name}>`,
      "MISSING_ARGUMENT",
      { argument: name },
    );
  }
  return value;
}

export const lib: CommandHandler = async (ctx) => {
  const sub = ctx.positionals[0];
  const projectDir = asString(ctx.options["project-dir"]);

  switch (sub) {
    case "search": {
      const query = requireArg(ctx, 1, "query");
      return searchLibraries(
        query,
        parseNumberOption(ctx.options.limit, "limit"),
      );
    }
    case "install": {
      const name = requireArg(ctx, 1, "library-name");
      return installLibrary(name, {
        projectDir,
        version: asString(ctx.options.version),
      });
    }
    case "uninstall": {
      const name = requireArg(ctx, 1, "library-name");
      return uninstallLibrary(name, projectDir);
    }
    case "update": {
      const name = requireArg(ctx, 1, "library-name");
      return updateLibrary(name, projectDir);
    }
    case "list":
      return listInstalledLibraries(projectDir);
    default:
      throw new PlatformIOError(
        `Unknown lib subcommand: ${sub ?? "(none)"}. ` +
          `Expected one of: search, install, uninstall, update, list.`,
        "UNKNOWN_SUBCOMMAND",
        { subcommand: sub },
      );
  }
};
