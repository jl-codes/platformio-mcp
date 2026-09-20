/** Bounded CLI debugger sequences over the same connection-owned MCP implementation. */
import { z } from "zod";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import {
  DebugCompatibilityClient,
  DebugStartCompatibilitySchema,
} from "./debug-compat.js";
import { prepareDebugCommand } from "../core/debug/debug-command.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { PlatformIOError } from "../utils/errors.js";

/** Validate the whole sequence before starting a build or touching a probe. */
export function parseDebugRunCli(
  options: Record<string, string | boolean>,
  positionals: readonly string[],
  projectDir?: string,
) {
  const invalid = () =>
    new PlatformIOError(
      "Invalid debug-run arguments.",
      "DEBUG_CLI_ARGUMENT_INVALID",
    );
  const allowed = new Set([
    "json",
    "approve",
    "project-dir",
    "environment",
    "commands",
    "load",
    "timeout",
    "command-timeout",
    "probe-serial",
    "process-only",
  ]);
  if (
    !projectDir ||
    positionals.length ||
    Object.keys(options).some((key) => !allowed.has(key))
  )
    throw invalid();
  for (const flag of ["json", "approve", "load", "process-only"]) {
    if (
      options[flag] !== undefined &&
      ![true, false, "true", "false"].includes(options[flag])
    )
      throw invalid();
  }
  const bool = (key: string, fallback: boolean) =>
    options[key] === undefined
      ? fallback
      : options[key] === true || options[key] === "true";
  const number = (key: string, fallback: number) => {
    const value = options[key];
    if (value === undefined) return fallback;
    if (
      typeof value !== "string" ||
      !value.trim() ||
      !Number.isFinite(Number(value))
    )
      throw invalid();
    return Number(value);
  };
  let raw: unknown;
  try {
    if (
      typeof options.commands !== "string" ||
      Buffer.byteLength(options.commands) > 65536
    )
      throw invalid();
    raw = JSON.parse(options.commands);
  } catch {
    throw invalid();
  }
  const commands = z
    .array(z.string().min(1).max(4096))
    .min(1)
    .max(32)
    .safeParse(raw);
  if (!commands.success) throw invalid();
  for (const command of commands.data) prepareDebugCommand(command);
  const commandTimeout = number("command-timeout", 30);
  if (commandTimeout < 0.001 || commandTimeout > 600) throw invalid();
  const start = DebugStartCompatibilitySchema.safeParse({
    project_dir: projectDir,
    env: options.environment,
    load: bool("load", true),
    timeout_s: number("timeout", 90),
    probe:
      options["probe-serial"] === undefined
        ? undefined
        : { serial_number: options["probe-serial"] },
  });
  if (!start.success) throw invalid();
  return {
    start: start.data,
    commands: commands.data,
    commandTimeout,
    processOnly: bool("process-only", false),
  };
}

/** Own one session for the sequence; always attempt process cleanup, including denied reset/run hooks. */
export async function executeDebugRunCli(
  input: ReturnType<typeof parseDebugRunCli>,
  caller: PolicyEvaluationContext,
) {
  const client = new DebugCompatibilityClient();
  try {
    const start = await dispatchAuthorizedAction(
      "debug_start",
      input.start,
      caller,
      () => client.start(input.start, {}, caller),
    );
    const results = [];
    let ok = true;
    for (const command of input.commands) {
      const args = {
        session_id: start.session_id,
        command,
        timeout_s: input.commandTimeout,
      };
      const result = await dispatchAuthorizedAction(
        "debug_cmd",
        args,
        caller,
        () => client.execute("pio_debug_cmd", args, caller),
      );
      results.push(result);
      if (!result.ok) {
        ok = false;
        break;
      }
    }
    const stopArgs = {
      session_id: start.session_id,
      timeout_s: input.commandTimeout,
      process_only: input.processOnly,
    };
    const stop = input.processOnly
      ? await client.execute("pio_debug_stop", stopArgs, caller)
      : await dispatchAuthorizedAction("debug_stop", stopArgs, caller, () =>
          client.execute("pio_debug_stop", stopArgs, caller),
        );
    return {
      ok: ok && stop.ok,
      start,
      results,
      stop,
      completedCommands: results.length,
    };
  } finally {
    const cleanup = await client.close();
    if (cleanup.cleanupPending)
      throw new PlatformIOError(
        "Debugger cleanup remains pending; the probe must not be treated as free.",
        "DEBUG_CLI_CLEANUP_PENDING",
        cleanup,
      );
  }
}
