export type OptionValue = string | boolean;

export interface CommandContext {
  options: Record<string, OptionValue>;
  positionals: string[];
  jsonMode: boolean;
  /**
   * The unparsed argv tail for this command (everything after the command
   * word itself), before parseArgs split it into options/positionals.
   * Optional and populated only by the real CLI dispatch in src/cli.ts;
   * omitted by callers (including tests) that construct a CommandContext by
   * hand. Only `install` needs it, to preserve its pre-existing
   * `--flag[=value]` token scanning exactly rather than reconstructing an
   * equivalent from `options`, which parses `=value` out (see
   * src/cli/commands/system.ts).
   */
  rawArgs?: string[];
}

/**
 * A command handler returns the value to print, or undefined if it has already
 * printed. It throws PlatformIOError subclasses for failures; src/cli.ts owns
 * the catch, formatting, and exit code.
 */
export type CommandHandler = (ctx: CommandContext) => Promise<unknown>;
