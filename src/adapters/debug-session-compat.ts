/** Reference debugger command/list/stop vocabulary over connection-owned sessions. */
import { z } from "zod";
import type { DebugClientSessions } from "../core/debug/debug-client-sessions.js";
import type { GdbMiField } from "../core/debug/gdb-mi.js";
import type { GdbMiCommandResult } from "../core/debug/gdb-mi-session.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { PlatformIOError } from "../utils/errors.js";

const sessionId = z.string().uuid();
const approvalId = z.string().min(1).max(256).optional();
const timeout = z.number().finite().min(0.001).max(600).default(30);
/** Strict public arguments never select a process, executable, or connection owner. */
export const DebugCommandCompatibilitySchema = z
  .object({
    session_id: sessionId,
    command: z.string().min(1).max(65536),
    timeout_s: timeout,
    approval_id: approvalId,
    target_approval_id: approvalId,
  })
  .strict();
/** Process-only recovery is explicit; normal stop runs Core's configured reset/run hook. */
export const DebugStopCompatibilitySchema = z
  .object({
    session_id: sessionId,
    timeout_s: timeout,
    host_approval_id: approvalId,
    target_approval_id: approvalId,
    process_only: z.boolean().default(false),
  })
  .strict();
/** Listing is scoped to the authenticated connection and accepts no owner selector. */
export const DebugListCompatibilitySchema = z.object({}).strict();

function field(fields: readonly GdbMiField[], name: string) {
  return fields.find((entry) => entry.name === name)?.value;
}
function text(fields: readonly GdbMiField[], name: string) {
  const value = field(fields, name);
  return typeof value === "string" ? value : null;
}
/** Normalize only known MI fields; debugger-controlled keys never become object properties. */
export function normalizeDebuggerStop(record?: GdbMiCommandResult["stopped"]) {
  if (!record) return null;
  const value = field(record.fields, "frame");
  const fields =
    value && typeof value !== "string" && value.kind === "tuple"
      ? value.fields
      : [];
  return {
    reason: text(record.fields, "reason"),
    signal_name: text(record.fields, "signal-name"),
    signal_meaning: text(record.fields, "signal-meaning"),
    thread_id: text(record.fields, "thread-id"),
    frame: fields.length
      ? {
          function: text(fields, "func"),
          address: text(fields, "addr"),
          file: text(fields, "fullname") ?? text(fields, "file"),
          line: text(fields, "line"),
        }
      : null,
  };
}
/** Translate transport observations without claiming a timeout stopped the target. */
export function formatDebuggerCommandResult(result: GdbMiCommandResult) {
  const resultClass = result.result?.class ?? null;
  const error =
    resultClass === "error"
      ? (text(result.result!.fields, "msg") ?? "GDB command failed.")
      : null;
  return {
    ok:
      error === null &&
      !result.timedOut &&
      !(result.closed && resultClass !== "exit"),
    result_class: resultClass,
    // Preserve bounded ordered MI fields: inspection results may have no console stream.
    result_fields: result.result?.fields ?? [],
    console: result.console,
    error,
    stopped: normalizeDebuggerStop(result.stopped),
    running: result.running,
    timed_out: result.timedOut,
    closed: result.closed,
    exit_code: result.exitCode,
    truncated: result.truncated,
    summary:
      error ??
      (result.timedOut
        ? "Debugger command timed out; target state is reported separately."
        : `Debugger result: ${resultClass ?? "no result record"}.`),
  };
}
/** Dispatch already-owned session operations; every command retains core policy enforcement. */
export async function executeDebugSessionCompatibility(
  name: "pio_debug_cmd" | "pio_debug_list" | "pio_debug_stop",
  input: unknown,
  sessions: DebugClientSessions,
  caller: PolicyEvaluationContext = {},
) {
  const invalid = () =>
    new PlatformIOError(
      "Invalid debugger compatibility arguments.",
      "COMPAT_ARGUMENT_INVALID",
    );
  if (name === "pio_debug_list") {
    if (!DebugListCompatibilitySchema.safeParse(input).success) throw invalid();
    const rows = sessions.list().map(({ lastStop, exitCode, ...row }) => ({
      ...row,
      exit_code: exitCode,
      stopped: normalizeDebuggerStop(lastStop),
    }));
    return {
      ok: true,
      sessions: rows,
      summary: `${rows.length} owned debugger session(s).`,
    };
  }
  if (name === "pio_debug_cmd") {
    const parsed = DebugCommandCompatibilitySchema.safeParse(input);
    if (!parsed.success) throw invalid();
    const args = parsed.data;
    return formatDebuggerCommandResult(
      await sessions.command(
        args.session_id,
        args.command,
        caller,
        Math.ceil(args.timeout_s * 1000),
        args.approval_id,
        args.target_approval_id,
      ),
    );
  }
  const parsed = DebugStopCompatibilitySchema.safeParse(input);
  if (!parsed.success) throw invalid();
  const args = parsed.data;
  if (args.process_only) await sessions.stop(args.session_id);
  else
    await sessions.resetRunAndStop(
      args.session_id,
      caller,
      Math.ceil(args.timeout_s * 1000),
      {
        hostApprovalId: args.host_approval_id,
        targetApprovalId: args.target_approval_id,
      },
    );
  return {
    ok: true,
    session_id: args.session_id,
    cleanup_pending: false,
    reset_run_acknowledged: !args.process_only,
    target_running_verified: false,
    summary: args.process_only
      ? "Owned debugger processes closed and probe custody released."
      : "Configured reset/run hook acknowledged; owned debugger processes closed and probe custody released.",
  };
}
