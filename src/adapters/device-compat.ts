/**
 * Reference serial-device presentation without opening ports or asserting hardware identity.
 * Provides projectCompatibilityDevices for authorized discovery adapters.
 */
import { inspectPortDiagnostics } from "../core/devices/port-diagnostics.js";
import { executeMemoryCompatibility } from "./memory-compat.js";
import {
  resolveMonitorRequest,
  startCompatibilityMonitor,
  captureCompatibilityMonitor,
} from "./monitor-start-compat.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { SerialClientContext } from "./serial-client.js";
import type { CompatibilityProjectDefaults } from "./compatibility-project.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import type { RegisteredTool } from "../mcp/tool-registry.js";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import { listDevicesCore } from "../core/devices.js";
import { PlatformIOError } from "../utils/errors.js";
import type { SerialSessionInfo } from "../core/serial/session-manager.js";
import type { SerialDevice } from "../types.js";

// Hint patterns adapted from the pinned reference devices.py; these are not identity checks.
const DEVELOPMENT_BOARD_HINT =
  /CP210|CH34|CH9102|FTDI|FT23|Silicon Labs|SLAB|usbserial|usbmodem|wchusbserial|ttyUSB|ttyACM|ESP|Arduino|STLink|ST-Link|JLink|J-Link|CMSIS|DAPLink|Espressif|USB/i;
const NOISE_PORT_HINT = /Bluetooth|debug-console|Jabra|AirPods|iPhone/i;

/**
 * Preserve the reference row shape and stable likely-first ordering.
 * Claim records and inferred board identities are deliberately not copied into public rows.
 * Monitor sessions must be supplied separately by the caller-owned session service.
 */
export function projectCompatibilityDevices(devices: readonly SerialDevice[]) {
  const rows = devices.map((device) => {
    const description = `${device.description} ${device.hwid} ${device.port}`;
    return {
      port: device.port,
      description: device.description,
      hwid: device.hwid,
      likely_dev_board:
        DEVELOPMENT_BOARD_HINT.test(description) &&
        !NOISE_PORT_HINT.test(description),
    };
  });
  rows.sort(
    (left, right) =>
      Number(right.likely_dev_board) - Number(left.likely_dev_board),
  );
  const likely = rows
    .filter((row) => row.likely_dev_board)
    .map((row) => row.port);
  return {
    ok: true as const,
    summary: `${rows.length} serial port(s). ${likely.length ? `Likely dev boards: ${likely.join(", ")}.` : "No port looks like a USB dev board; check the cable (data, not charge-only) and drivers."}`,
    devices: rows,
    likely_ports: likely,
  };
}

/** Discover devices and caller-owned sessions through both canonical permission checks. */
export async function executeDeviceCompatibility(
  client: SerialClientContext,
  name: string,
  input: unknown,
  defaults: CompatibilityProjectDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  if (name === "pio_port_diagnose") {
    const params = z
      .object({
        port: z.string().min(1).max(512).nullable().optional(),
        project_dir: z.string().min(1).max(32768).nullable().optional(),
        env: z.string().min(1).max(50).nullable().optional(),
        approval_id: z.string().max(256).optional(),
        config_approval_id: z.string().max(256).optional(),
        selection_approval_id: z.string().max(256).optional(),
        monitor_approval_id: z.string().max(256).optional(),
      })
      .strict()
      .parse(input);
    const { monitor_approval_id, ...resolution } = params;
    const { request } = await resolveMonitorRequest(
      resolution,
      defaults,
      caller,
      projectCompatibilityDevices,
    );
    const projectDir = request.projectDir;
    const guard = createPolicyRevisionGuard(projectDir);
    return client.run(
      { caller, approvalId: monitor_approval_id },
      (service, owner) =>
        dispatchAuthorizedAction(
          "list_devices",
          { projectDir, approvalId: params.approval_id },
          { ...caller, workspaceDir: projectDir },
          async () => {
            await onAuthorized?.();
            const sessions = await service.listSessions(owner, projectDir);
            guard();
            const devices = await listDevicesCore().catch(() => null);
            guard();
            const normalize = async (value: string) => {
              if (process.platform !== "win32")
                return fs.realpath(value).catch(() => value);
              const prefix = String.fromCharCode(92, 92, 46, 92);
              return (
                value.startsWith(prefix) ? value.slice(4) : value
              ).toUpperCase();
            };
            const portKey = await normalize(request.path);
            const listed =
              devices === null
                ? null
                : (
                    await Promise.all(
                      devices.map(
                        async (device) =>
                          (await normalize(device.port)) === portKey,
                      ),
                    )
                  ).some(Boolean);
            const owned = (
              await Promise.all(
                sessions.map(async (session) => ({
                  session,
                  matches: (await normalize(session.path)) === portKey,
                })),
              )
            ).find((row) => row.matches)?.session;
            const diagnostics = await inspectPortDiagnostics(
              request.path,
              listed,
            );
            guard();
            const hint = owned
              ? `Stop owned monitor session ${owned.sessionId} before flashing.`
              : diagnostics.held_by_processes.length
                ? "Another process holds this port; close its serial connection before flashing."
                : diagnostics.exists === false
                  ? "Port was not found; check the connection and selected port."
                  : "No owner was observed. This does not establish exclusive access; opening still requires authorization and a device lease.";
            return {
              ok: true,
              summary: hint,
              port: request.path,
              ...diagnostics,
              held_by_session: owned?.sessionId ?? null,
              hint,
            };
          },
        ),
    );
  }
  if (name === "pio_memory_watch")
    return executeMemoryCompatibility(
      client,
      input,
      defaults,
      caller,
      projectCompatibilityDevices,
    );
  if (name === "pio_monitor_capture") {
    const { result, session } = await captureCompatibilityMonitor(
      client,
      input,
      defaults,
      caller,
      projectCompatibilityDevices,
    );
    return {
      ok: !session.cleanupPending,
      summary: `captured ${result.lines.length} line(s) from ${session.path} at ${session.baudRate} baud.${session.cleanupPending ? " Port closure is unconfirmed; device ownership is retained." : ""}`,
      port: session.path,
      baud: session.baudRate,
      lines: result.lines,
      matched: result.matched,
      partial_line: result.partial,
      error: result.error ?? session.cleanupError ?? null,
      cleanup_pending: session.cleanupPending,
      ...(session.cleanupPending ? { session_id: session.sessionId } : {}),
    };
  }
  if (name === "pio_monitor_start") {
    const session = await startCompatibilityMonitor(
      client,
      input,
      defaults,
      caller,
      projectCompatibilityDevices,
    );
    const info = projectCompatibilitySession(session);
    return {
      ok: session.state === "open",
      summary:
        session.state !== "open"
          ? `Monitor session ${info.session_id} is ${session.state}; inspect its state before continuing.`
          : `Monitoring ${info.port} at ${info.baud} baud in session ${info.session_id}. Read with pio_monitor_read(session_id='${info.session_id}', cursor=0). Stop before flashing.`,
      ...info,
    };
  }
  if (name === "pio_monitor_read") {
    const params = z
      .object({
        session_id: z.string().min(1).max(256),
        cursor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
        max_lines: z.number().int().min(1).max(10000).default(200),
        wait_for: z.string().max(4096).nullable().optional(),
        timeout_s: z.number().finite().default(10),
        approval_id: z.string().max(256).optional(),
      })
      .strict()
      .parse(input);
    return client.run(
      { caller, approvalId: params.approval_id },
      async (service, owner) => {
        const result = await service.sessions.read(owner, params.session_id, {
          cursor: params.cursor,
          maxLines: params.max_lines,
          timeoutMs: Math.round(
            Math.max(0, Math.min(params.timeout_s, 120)) * 1000,
          ),
          waitFor: params.wait_for || undefined,
          patternOptions: { mode: "regex", pythonNamedGroups: true },
          referenceSemantics: true,
        });
        const closed = result.state !== "open";
        let summary = params.wait_for
          ? `pattern ${result.matched ? "matched" : `not matched within ${params.timeout_s}s`}; ${result.lines.length} new line(s). Next cursor ${result.cursor}.`
          : `${result.lines.length} new line(s); next cursor ${result.cursor}.` +
            (result.moreAvailable ? " More available, read again." : "");
        if (result.droppedLines)
          summary += ` ${result.droppedLines} older line(s) fell out of the buffer.`;
        if (closed)
          summary += ` Session closed${result.error ? `: ${result.error}` : ""}.`;
        return {
          ok: true,
          summary,
          session_id: params.session_id,
          lines: result.lines,
          cursor: result.cursor,
          dropped_before_cursor: result.droppedLines,
          more_available: result.moreAvailable,
          matched: result.matched,
          matched_line: result.matchedLine ?? null,
          partial_line: result.partial,
          closed,
          error: result.error ?? null,
          redaction_applied: result.redactionApplied,
          truncated_bytes: result.totalTruncatedBytes,
        };
      },
    );
  }
  if (name === "pio_monitor_write") {
    const params = z
      .object({
        session_id: z.string().min(1).max(256),
        text: z.string().max(65536),
        newline: z.boolean().default(true),
        approval_id: z.string().max(256).optional(),
      })
      .strict()
      .parse(input);
    const bytes = Buffer.from(
      params.text + (params.newline ? "\n" : ""),
      "utf8",
    );
    if (bytes.length > 65536)
      throw new PlatformIOError(
        "Serial writes are limited to 64 KiB including the newline.",
        "SERIAL_WRITE_LIMIT",
      );
    return client.run(
      { caller, approvalId: params.approval_id },
      async (service, owner) => {
        const result = await service.sessions.write(
          owner,
          params.session_id,
          bytes,
        );
        const session = service.sessions
          .list(owner)
          .find((item) => item.sessionId === params.session_id);
        return {
          ok: true,
          summary: `sent ${result.bytesWritten} byte(s) to ${session?.path ?? "serial port"}.`,
          session_id: params.session_id,
          bytes: result.bytesWritten,
        };
      },
    );
  }
  if (name === "pio_monitor_stop") {
    const params = z
      .object({ session_id: z.string().min(1).max(256) })
      .strict()
      .parse(input);
    return client.run({ caller }, async (service, owner) => {
      const session = await service.sessions.stop(owner, params.session_id);
      const info = projectCompatibilitySession(session);
      return {
        ok: !session.cleanupPending,
        summary: session.cleanupPending
          ? `Session ${params.session_id} closure is unconfirmed; device ownership is retained.`
          : `session ${params.session_id} on ${info.port} closed after ${info.uptime_s}s and ${info.bytes_received} bytes.`,
        ...info,
      };
    });
  }
  if (name === "pio_monitor_list") {
    const params = z
      .object({ approval_id: z.string().max(256).optional() })
      .strict()
      .parse(input);
    const projectDir = await fs.realpath(
      path.resolve(defaults.projectDir ?? defaults.cwd ?? process.cwd()),
    );
    return client.run(
      { caller, approvalId: params.approval_id },
      async (service, owner) => {
        const sessions = (await service.listSessions(owner, projectDir)).map(
          projectCompatibilitySession,
        );
        await onAuthorized?.();
        return {
          ok: true,
          summary: `${sessions.length} open session(s).`,
          sessions,
        };
      },
    );
  }
  if (name !== "pio_list_devices")
    throw new PlatformIOError(
      "Unknown device compatibility tool.",
      "COMPAT_TOOL_UNKNOWN",
    );
  const params = z
    .object({
      approval_id: z.string().max(256).optional(),
      monitor_approval_id: z.string().max(256).optional(),
    })
    .strict()
    .parse(input);
  const projectDir = await fs.realpath(
    path.resolve(defaults.projectDir ?? defaults.cwd ?? process.cwd()),
  );
  const guard = createPolicyRevisionGuard(projectDir);
  return client.run(
    { approvalId: params.monitor_approval_id, caller },
    (service, owner) =>
      dispatchAuthorizedAction(
        "list_devices",
        { projectDir, approvalId: params.approval_id },
        { ...caller, workspaceDir: projectDir },
        async () => {
          await onAuthorized?.();
          const sessions = await service.listSessions(owner, projectDir);
          guard();
          const devices = await listDevicesCore();
          guard();
          return {
            ...projectCompatibilityDevices(devices),
            open_monitor_sessions: sessions.map(projectCompatibilitySession),
          };
        },
      ),
  );
}

/** Add the explicitly enabled alias without changing canonical discovery metadata. */
export function withDeviceCompatibility<TResult>(
  base: ReadonlyMap<string, RegisteredTool<TResult>>,
) {
  const source = base.get("list_devices");
  if (!source || base.has("pio_list_devices"))
    throw new Error("Invalid device compatibility registry");
  const result = new Map(base);
  result.set("pio_list_devices", {
    ...source,
    name: "pio_list_devices",
    description:
      "List serial device hints and caller-owned monitor sessions under canonical permissions.",
    inputSchema: {
      type: "object",
      properties: {
        approval_id: { type: "string" },
        monitor_approval_id: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (args, context) => context.dispatch("pio_list_devices", args),
  });
  result.set("pio_port_diagnose", {
    ...source,
    name: "pio_port_diagnose",
    description:
      "Inspect serial-port presence, permissions and observed holders without opening or closing the device. Missing holder evidence does not prove availability.",
    inputSchema: {
      type: "object",
      properties: {
        port: { type: ["string", "null"], maxLength: 512 },
        project_dir: { type: ["string", "null"], maxLength: 32768 },
        env: { type: ["string", "null"], maxLength: 50 },
        approval_id: { type: "string", maxLength: 256 },
        config_approval_id: { type: "string", maxLength: 256 },
        selection_approval_id: { type: "string", maxLength: 256 },
        monitor_approval_id: { type: "string", maxLength: 256 },
      },
      additionalProperties: false,
    },
    handler: (args, context) => context.dispatch("pio_port_diagnose", args),
  });
  const startSource = base.get("start_monitor");
  if (!startSource || result.has("pio_monitor_start"))
    throw new Error("Invalid serial startup compatibility registry");
  result.set("pio_monitor_start", {
    ...startSource,
    name: "pio_monitor_start",
    policyAction: "serial_session_start",
    annotations: {
      ...startSource.annotations,
      title: "Start Monitor",
      idempotentHint: false,
    },
    description:
      "Start an owned serial monitor using explicit arguments, resolved project settings, or an unambiguous device candidate. Opening requires hardware authorization and exclusive device ownership.",
    inputSchema: {
      type: "object",
      properties: {
        port: { type: ["string", "null"], maxLength: 512 },
        baud: { type: ["integer", "null"], minimum: 1, maximum: 4000000 },
        project_dir: { type: ["string", "null"] },
        env: { type: ["string", "null"] },
        max_lines: {
          type: "integer",
          minimum: 1,
          maximum: 10000,
          default: 5000,
        },
        approval_id: { type: "string" },
        config_approval_id: { type: "string" },
        selection_approval_id: { type: "string" },
        discovery_approval_id: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (args, context) => context.dispatch("pio_monitor_start", args),
  });
  const captureSource = result.get("pio_monitor_start")!;
  const startProperties = captureSource.inputSchema.properties as Record<
    string,
    unknown
  >;
  result.set("pio_monitor_capture", {
    ...captureSource,
    name: "pio_monitor_capture",
    annotations: { ...captureSource.annotations, title: "Capture Monitor" },
    description:
      "Open, read and close an owned serial monitor. Both opening and reading must be authorized before startup; unconfirmed closure retains device ownership.",
    inputSchema: {
      type: "object",
      properties: {
        ...startProperties,
        seconds: { type: "number", default: 5 },
        until: { type: ["string", "null"], maxLength: 4096 },
        max_lines: {
          type: "integer",
          minimum: 1,
          maximum: 10000,
          default: 500,
        },
        read_approval_id: { type: "string", maxLength: 256 },
      },
      additionalProperties: false,
    },
    handler: (args, context) => context.dispatch("pio_monitor_capture", args),
  });
  result.set("pio_memory_watch", {
    ...captureSource,
    name: "pio_memory_watch",
    annotations: { ...captureSource.annotations, title: "Watch Memory" },
    description:
      "Collect bounded heap/stack telemetry from an owned session or an authorized temporary monitor. Reports sample-window trends, explicit unknown units and incomplete collection; does not prove a memory leak.",
    inputSchema: {
      type: "object",
      properties: {
        ...startProperties,
        session_id: { type: ["string", "null"] },
        seconds: { type: "number", default: 15 },
        pattern: { type: ["string", "null"], maxLength: 4096 },
        stack_warn_bytes: { type: "integer", minimum: 0, default: 512 },
        stack_unit: { type: "string", enum: ["bytes", "words"] },
        stack_word_bytes: { type: "integer", minimum: 1, maximum: 16 },
        read_approval_id: { type: "string", maxLength: 256 },
      },
      additionalProperties: false,
    },
    handler: (args, context) => context.dispatch("pio_memory_watch", args),
  });
  const readSource = base.get("query_logs");
  if (!readSource || result.has("pio_monitor_read"))
    throw new Error("Invalid serial read compatibility registry");
  result.set("pio_monitor_read", {
    ...readSource,
    name: "pio_monitor_read",
    policyAction: "serial_session_read",
    annotations: { ...readSource.annotations, title: "Read Monitor" },
    description:
      "Read an owned monitor with cursors and bounded Python-compatible regex matching on completed lines. Maximum wait 120 seconds; response and storage byte limits apply.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", minLength: 1, maxLength: 256 },
        cursor: { type: "integer", minimum: 0, default: 0 },
        max_lines: {
          type: "integer",
          minimum: 1,
          maximum: 10000,
          default: 200,
        },
        wait_for: { type: ["string", "null"], maxLength: 4096 },
        timeout_s: { type: "number", default: 10 },
        approval_id: { type: "string", maxLength: 256 },
      },
      required: ["session_id"],
      additionalProperties: false,
    },
    handler: (args, context) => context.dispatch("pio_monitor_read", args),
  });
  const writeSource = base.get("upload_firmware");
  if (!writeSource || result.has("pio_monitor_write"))
    throw new Error("Invalid serial write compatibility registry");
  result.set("pio_monitor_write", {
    ...writeSource,
    name: "pio_monitor_write",
    policyAction: "serial_session_write",
    annotations: {
      ...writeSource.annotations,
      title: "Write Monitor",
      idempotentHint: false,
    },
    description:
      "Write UTF-8 text to an owned serial session after payload-bound hardware authorization. Limited to 64 KiB including the optional newline.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", minLength: 1, maxLength: 256 },
        text: { type: "string", maxLength: 65536 },
        newline: { type: "boolean", default: true },
        approval_id: { type: "string", maxLength: 256 },
      },
      required: ["session_id", "text"],
      additionalProperties: false,
    },
    handler: (args, context) => context.dispatch("pio_monitor_write", args),
  });
  for (const [name, canonical] of [
    ["pio_monitor_list", "get_monitor_status"],
    ["pio_monitor_stop", "stop_monitor"],
  ] as const) {
    const source = base.get(canonical);
    if (!source || result.has(name))
      throw new Error("Invalid monitor compatibility registry");
    result.set(name, {
      ...source,
      name,
      description:
        name === "pio_monitor_list"
          ? "List this connection's authorized monitor sessions."
          : "Close an owned monitor session, retaining device ownership until closure is confirmed.",
      inputSchema: {
        type: "object",
        properties:
          name === "pio_monitor_list"
            ? { approval_id: { type: "string" } }
            : { session_id: { type: "string" } },
        ...(name === "pio_monitor_stop" ? { required: ["session_id"] } : {}),
        additionalProperties: false,
      },
      handler: (args, context) => context.dispatch(name, args),
    });
  }
  return result;
}

/** Present bounded owned-session metadata without disclosing serial content. */
export function projectCompatibilitySession(session: SerialSessionInfo) {
  return {
    session_id: session.sessionId,
    port: session.path,
    baud: session.baudRate,
    lines_buffered: session.linesBuffered,
    next_cursor: session.nextCursor,
    bytes_received: session.bytesReceived,
    uptime_s:
      Math.round(
        Math.max(0, Date.now() - Date.parse(session.startedAt)) / 100,
      ) / 10,
    closed:
      !session.cleanupPending &&
      ["stopped", "disconnected", "error"].includes(session.state),
    error:
      session.cleanupError ??
      (session.state === "error" ? "SERIAL_TRANSPORT_ERROR" : null),
    cleanup_pending: session.cleanupPending,
  };
}
