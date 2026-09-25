/** Reference debugger command/list/stop vocabulary over connection-owned sessions. */
import { z } from "zod";
import type { DebugClientSessions } from "../core/debug/debug-client-sessions.js";
import type {
  GdbMiField,
  GdbMiValue,
  GdbMiRecord,
} from "../core/debug/gdb-mi.js";
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

/** Project ordered MI data into the reference JSON shape without prototype setters. */
function payload(fields: readonly GdbMiField[]): Record<string, unknown> {
  const output: Record<string, unknown> = Object.create(null);
  const repeated = new Set<string>();
  for (const entry of fields) {
    const value = miValue(entry.value);
    if (!Object.hasOwn(output, entry.name)) output[entry.name] = value;
    else if (repeated.has(entry.name))
      (output[entry.name] as unknown[]).push(value);
    else {
      output[entry.name] = [output[entry.name], value];
      repeated.add(entry.name);
    }
  }
  return output;
}
function miValue(value: GdbMiValue): unknown {
  if (typeof value === "string") return value;
  if (value.kind === "tuple") return payload(value.fields);
  if (value.kind === "list") return value.values.map(miValue);
  return value.fields.map((entry) => payload([entry]));
}
function referenceRecord(record: GdbMiRecord) {
  if (record.kind === "stream")
    return { kind: record.channel, text: record.text };
  if (record.kind === "other") return { kind: record.kind, text: record.text };
  if (record.kind === "prompt") return { kind: record.kind };
  return {
    kind: record.kind,
    ...(record.token ? { token: record.token } : {}),
    class: record.class,
    ...(record.fields.length ? { payload: payload(record.fields) } : {}),
  };
}
function lines(chunks: string[] = [], separator = "") {
  const joined = chunks.join(separator);
  if (!joined) return [];
  const result = joined.split(/\r\n|\n|\r/);
  if (result[result.length - 1] === "") result.pop();
  return result;
}

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
    ...Object.fromEntries(
      ["bkptno", "exit-code", "disp"]
        .filter((key) => field(record.fields, key) !== undefined)
        .map((key) => [key.replaceAll("-", "_"), text(record.fields, key)]),
    ),
    frame: fields.length
      ? {
          function: text(fields, "func"),
          address: text(fields, "addr"),
          file: text(fields, "fullname") ?? text(fields, "file"),
          line: (() => {
            const line = text(fields, "line");
            return line !== null &&
              /^-?[0-9]+$/.test(line) &&
              Number.isSafeInteger(Number(line))
              ? Number(line)
              : line;
          })(),
          args:
            field(fields, "args") === undefined
              ? []
              : miValue(field(fields, "args")!),
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
    result: payload(result.result?.fields ?? []),
    console: lines(result.console),
    log: lines(result.log),
    target_output: lines(result.targetOutput),
    other_output: lines(result.otherOutput, "\n"),
    records: (result.records ?? []).map(referenceRecord),
    duration_s: result.durationSeconds ?? 0,
    note: null,
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
/** Share observed session metadata across start, list and stop replies. */
export function formatDebuggerSessionInfo(
  row: ReturnType<DebugClientSessions["list"]>[number],
) {
  const { lastStop, exitCode, stopCount, recordsBuffered, ...rest } = row;
  const stopped = normalizeDebuggerStop(lastStop);
  return {
    ...rest,
    exit_code: exitCode,
    last_stop: stopped,
    stopped,
    stop_count: stopCount ?? null,
    records_buffered: recordsBuffered ?? null,
    error: row.error ?? null,
    init_script_path: row.init_script_path ?? null,
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
    const rows = sessions.list().map(formatDebuggerSessionInfo);
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
    const result = await sessions.command(
      args.session_id,
      args.command,
      caller,
      Math.ceil(args.timeout_s * 1000),
      args.approval_id,
      args.target_approval_id,
    );
    return {
      ...formatDebuggerCommandResult(result),
      session_id: args.session_id,
      command: args.command.trim(),
    };
  }
  const parsed = DebugStopCompatibilitySchema.safeParse(input);
  if (!parsed.success) throw invalid();
  const args = parsed.data;
  const info = sessions
    .list()
    .find((row) => row.session_id === args.session_id);
  const stoppingAt = performance.now();
  // An exited GDB cannot acknowledge a target hook. Still require owned cleanup
  // proof before removing its session or releasing probe custody.
  const resetRun = !args.process_only && info?.closed !== true;
  if (!resetRun) await sessions.stop(args.session_id);
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
    ...(info ? formatDebuggerSessionInfo(info) : {}),
    session_id: args.session_id,
    project_dir: info?.project_dir,
    env: info?.env,
    debug_tool: info?.debug_tool ?? null,
    gdb_version: info?.gdb_version ?? null,
    uptime_s: info
      ? info.uptime_s + Math.max(0, (performance.now() - stoppingAt) / 1000)
      : null,
    closed: true,
    cleanupPending: false,
    cleanup_pending: false,
    reset_run_acknowledged: resetRun,
    target_running_verified: false,
    summary: !resetRun
      ? "Owned debugger processes closed and probe custody released."
      : "Configured reset/run hook acknowledged; owned debugger processes closed and probe custody released.",
  };
}
