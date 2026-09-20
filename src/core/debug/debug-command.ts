/**
 * Classify supported debugger commands before any bytes reach GDB.
 * Inspection also requires trusted startup with auto-loading and inferior calls disabled.
 */
import { PlatformIOError } from "../../utils/errors.js";
import { dispatchAuthorizedAction } from "../action-dispatcher.js";
import type { PolicyEvaluationContext } from "../policy/types.js";

/** Prepared transport command and its minimum permission category. */
export interface PreparedDebugCommand {
  miCommand: string;
  effect: "inspect" | "target" | "host-code";
  waitForStop: boolean;
}
const SIMPLE_EXPRESSION =
  /^[*&]?(?:\$?[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*|0x[0-9a-fA-F]+|[0-9]+)(?:(?:\.|->)[A-Za-z_][A-Za-z0-9_]*|\[[0-9]{1,6}\])*$/;

/** Compile an explicit vocabulary; unknown or compound expressions are not inferred safe. */
export function prepareDebugCommand(
  input: string,
): Readonly<PreparedDebugCommand> {
  const invalid = (): never => {
    throw new PlatformIOError(
      "Unsupported or unsafe debugger command.",
      "DEBUG_COMMAND_UNSUPPORTED",
    );
  };
  if (
    typeof input !== "string" ||
    Buffer.byteLength(input) > 4096 ||
    /[\x00-\x1f\x7f]/.test(input)
  )
    invalid();
  const command = input.trim();
  const make = (
    miCommand: string,
    effect: PreparedDebugCommand["effect"],
    waitForStop = false,
  ) => Object.freeze({ miCommand, effect, waitForStop });
  const consoleCommand = (
    text: string,
    effect: PreparedDebugCommand["effect"],
    waitForStop = false,
  ) =>
    make(
      "-interpreter-exec console " + JSON.stringify(text),
      effect,
      waitForStop,
    );
  const inspect: Record<string, string> = {
    bt: "-stack-list-frames",
    backtrace: "-stack-list-frames",
    where: "-stack-list-frames",
    "info locals": "-stack-list-locals --simple-values",
    "info args": "-stack-list-arguments --simple-values",
    "info registers": "-data-list-register-values x",
    "info threads": "-thread-info",
    "info breakpoints": "-break-list",
    "show version": "-gdb-version",
  };
  if (Object.hasOwn(inspect, command)) return make(inspect[command], "inspect");
  const execute: Record<string, string> = {
    continue: "-exec-continue",
    c: "-exec-continue",
    next: "-exec-next",
    n: "-exec-next",
    step: "-exec-step",
    s: "-exec-step",
    finish: "-exec-finish",
    interrupt: "-exec-interrupt",
  };
  if (Object.hasOwn(execute, command))
    return make(execute[command], "target", true);
  if (command === "detach" || command === "-target-detach")
    return make("-target-detach", "target");
  if (command === "quit" || command === "-gdb-exit")
    return make("-gdb-exit", "target");
  if (Object.values(inspect).includes(command)) return make(command, "inspect");
  if (Object.values(execute).includes(command))
    return make(command, "target", true);
  const print = /^(?:p|print)(?:\/([xduotacfs]))? (.+)$/.exec(command);
  if (print) {
    if (!SIMPLE_EXPRESSION.test(print[2])) return invalid();
    return print[1]
      ? consoleCommand("print /" + print[1] + " " + print[2], "inspect")
      : make(
          "-data-evaluate-expression " + JSON.stringify(print[2]),
          "inspect",
        );
  }
  const memory = /^x\/([1-9][0-9]{0,4})([xduotacfs])([bhwg]?) (.+)$/.exec(
    command,
  );
  if (memory) {
    if (Number(memory[1]) > 4096 || !SIMPLE_EXPRESSION.test(memory[4]))
      return invalid();
    return consoleCommand(command, "inspect");
  }
  const breakpoint = /^(break|b|tbreak|tb) (.+)$/.exec(command);
  if (breakpoint) {
    const location = breakpoint[2];
    const functionName =
      /^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*$/;
    const fileLine = /^[^"'\x60;$(){}\r\n]+:[1-9][0-9]{0,8}$/;
    if (
      location.startsWith("-") ||
      (!functionName.test(location) && !fileLine.test(location))
    )
      return invalid();
    return make(
      "-break-insert " +
        (["tbreak", "tb"].includes(breakpoint[1]) ? "-t " : "") +
        "-- " +
        JSON.stringify(location),
      "target",
    );
  }
  const watch = /^watch (.+)$/.exec(command);
  if (watch) {
    if (!SIMPLE_EXPRESSION.test(watch[1])) return invalid();
    return make("-break-watch " + JSON.stringify(watch[1]), "target");
  }
  const breakpointChange = /^(delete|disable|enable) ([1-9][0-9]{0,8})$/.exec(
    command,
  );
  if (breakpointChange)
    return make(
      "-break-" + breakpointChange[1] + " " + breakpointChange[2],
      "target",
    );
  const assignment =
    /^set (?:variable |var )?(.+?) = (-?(?:0x[0-9a-fA-F]+|[0-9]+)|true|false)$/.exec(
      command,
    );
  if (assignment) {
    if (!SIMPLE_EXPRESSION.test(assignment[1])) return invalid();
    return consoleCommand(
      "set variable " + assignment[1] + " = " + assignment[2],
      "target",
    );
  }
  if (
    [
      "monitor init",
      "monitor reset",
      "monitor reset halt",
      "monitor reset run",
      "monitor halt",
      "monitor resume",
    ].includes(command)
  )
    return consoleCommand(command, "target");
  if (/^(?:shell|python|source) .+/.test(command))
    return consoleCommand(command, "host-code");
  return invalid();
}

/** Bind debugger text and generated MI to canonical inspection, write or host-code authorization. */
export function dispatchDebuggerCommand<T>(
  command: string,
  args: Record<string, unknown>,
  caller: PolicyEvaluationContext,
  send: (prepared: Readonly<PreparedDebugCommand>) => Promise<T>,
): Promise<T> {
  const prepared = prepareDebugCommand(command);
  const operation =
    prepared.effect === "inspect"
      ? "debugger_inspect"
      : prepared.effect === "target"
        ? "debugger_mutate"
        : "debugger_host_code";
  return dispatchAuthorizedAction(
    operation,
    { ...args, command: command.trim(), miCommand: prepared.miCommand },
    caller,
    () => send(prepared),
  );
}
