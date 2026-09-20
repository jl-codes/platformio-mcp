/**
 * Reference serial-device presentation without opening ports or asserting hardware identity.
 * Provides projectCompatibilityDevices for authorized discovery adapters.
 */
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
