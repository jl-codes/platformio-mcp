/** Opt-in debugger tools share the connection-owned service and conservative effect annotations. */
import type { RegisteredTool } from "../mcp/tool-registry.js";

const approval = { type: "string", minLength: 1, maxLength: 256 };
const session = { type: "string", format: "uuid" };
const timeout = { type: "number", minimum: 0.001, maximum: 600, default: 30 };
/** Extend compatibility mode only; these schemas never expose executable or custody capabilities. */
export function withDebugCompatibility<TResult>(
  base: ReadonlyMap<string, RegisteredTool<TResult>>,
): ReadonlyMap<string, RegisteredTool<TResult>> {
  const result = new Map(base);
  const definitions = [
    {
      name: "pio_debug_start",
      description:
        "Build and start a connection-owned GDB session using PlatformIO's generated initialization, an identified USB probe and a local OpenOCD or modern J-Link backend. Host execution and target effects require separate permissions. Probe custody remains held until owned descendant groups close.",
      required: [],
      properties: {
        project_dir: { type: ["string", "null"] },
        env: { type: ["string", "null"] },
        load: { type: "boolean", default: true },
        timeout_s: { ...timeout, default: 90 },
        probe: {
          type: "object",
          additionalProperties: false,
          properties: {
            vendor_id: { type: "string", pattern: "^(?:0x)?[a-fA-F0-9]{4}$" },
            product_id: { type: "string", pattern: "^(?:0x)?[a-fA-F0-9]{4}$" },
            serial_number: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
        ...Object.fromEntries(
          [
            "config_approval_id",
            "build_approval_id",
            "system_approval_id",
            "resolution_approval_id",
            "image_approval_id",
            "discovery_approval_id",
            "approval_id",
            "initialization_host_approval_id",
            "initialization_target_approval_id",
            "backend_host_approval_id",
            "backend_target_approval_id",
          ].map((name) => [name, approval]),
        ),
      },
    },
    {
      name: "pio_debug_cmd",
      description:
        "Send a classified GDB/MI or console command to this connection's session. Inspection, target mutation and privileged host commands are authorized separately. Timeout does not halt a running target.",
      required: ["session_id", "command"],
      properties: {
        session_id: session,
        command: { type: "string", minLength: 1, maxLength: 65536 },
        timeout_s: timeout,
        approval_id: approval,
        target_approval_id: approval,
      },
    },
    {
      name: "pio_debug_stop",
      description:
        "Run the configured reset/run hook with host and target permissions, then close owned GDB/backend process groups and release probe custody. Set process_only for recovery without target commands; failed cleanup retains the session for retry.",
      required: ["session_id"],
      properties: {
        session_id: session,
        timeout_s: timeout,
        host_approval_id: approval,
        target_approval_id: approval,
        process_only: { type: "boolean", default: false },
      },
    },
    {
      name: "pio_debug_list",
      description:
        "List this connection's debugger sessions, observed target state and pending cleanup. Does not enumerate another connection's sessions or contact hardware.",
      required: [],
      properties: {},
    },
  ];
  for (const definition of definitions) {
    if (result.has(definition.name))
      throw new Error(`Duplicate compatibility tool: ${definition.name}`);
    const readOnly = definition.name === "pio_debug_list";
    result.set(definition.name, {
      name: definition.name,
      description: definition.description,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: definition.required,
        properties: definition.properties,
      },
      policyAction: readOnly ? "query_logs" : "run_shell_command",
      riskLevel: readOnly ? "low" : "critical",
      annotations: {
        title: definition.name,
        readOnlyHint: readOnly,
        destructiveHint: !readOnly,
        idempotentHint: readOnly,
        openWorldHint: !readOnly,
      },
      handler: (args, context) => context.dispatch(definition.name, args),
    });
  }
  return result;
}
