/** Register canonical power profiling and its opt-in reference alias over one implementation. */
import type { RegisteredTool } from "../mcp/tool-registry.js";
/** Public schema never exposes interpreter paths, identity assertions or custody capabilities. */
export function withPowerCompatibility<TResult>(
  base: ReadonlyMap<string, RegisteredTool<TResult>>,
  name: "power_profile" | "pio_power_profile" = "pio_power_profile",
): ReadonlyMap<string, RegisteredTool<TResult>> {
  const result = new Map(base);
  if (result.has(name)) throw new Error(`Duplicate power tool: ${name}`);
  result.set(name, {
    name,
    description:
      "Collect bounded serial current samples or PPK2 meter windows. PPK2 requires explicit mode, voltage/current limits, DUT port plus configured PIO_MCP_PPK2_ENV. An omitted meter port selects one matching PPK2 USB endpoint; ambiguous endpoints require explicit selection. Source mode requires independent power permission. operation=list/cleanup inspects or retries this connection's retained meter cleanup. An owned serial trigger retains DUT custody through meter cleanup. Explicit multi-interface selection pins the observed interface set and retains whole-device exclusion; physical acceptance is pending.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        operation: {
          type: "string",
          enum: ["profile", "list", "cleanup"],
          default: "profile",
        },
        power_operation_id: { type: "string", format: "uuid" },
        source: { type: "string", enum: ["serial", "ppk2"], default: "serial" },
        port: { type: ["string", "null"], maxLength: 512 },
        dut_port: { type: "string", maxLength: 512 },
        project_dir: { type: ["string", "null"], maxLength: 32768 },
        env: { type: ["string", "null"] },
        mode: { type: "string", enum: ["ampere", "source"] },
        seconds: {
          type: "number",
          exclusiveMinimum: 0,
          maximum: 600,
          default: 10,
        },
        baud: {
          type: "integer",
          minimum: 1,
          maximum: 4000000,
          default: 115200,
        },
        pattern: { type: ["string", "null"], maxLength: 4096 },
        voltage_mv: {
          type: ["number", "null"],
          exclusiveMinimum: 0,
          maximum: 1e9,
        },
        current_limit_ma: {
          type: "number",
          exclusiveMinimum: 0,
          maximum: 1000,
        },
        buckets: { type: "integer", minimum: 0, maximum: 1000, default: 20 },
        sleep_threshold_ma: {
          type: ["number", "null"],
          minimum: -1e9,
          maximum: 1e9,
        },
        max_lines: { type: "integer", minimum: 1, maximum: 10000 },
        provenance: {
          type: "string",
          enum: ["firmware_estimate", "external_meter", "unspecified_serial"],
        },
        trigger: { type: ["string", "null"], maxLength: 4096 },
        trigger_session_id: { type: ["string", "null"], maxLength: 256 },
        trigger_seconds: {
          type: "number",
          exclusiveMinimum: 0,
          maximum: 600,
          description: "Trigger wait limit; defaults to seconds when omitted.",
        },
        ...Object.fromEntries(
          [
            "profile_approval_id",
            "approval_id",
            "config_approval_id",
            "selection_approval_id",
            "discovery_approval_id",
            "read_approval_id",
            "trigger_approval_id",
            "host_approval_id",
            "power_approval_id",
          ].map((key) => [key, { type: "string", maxLength: 256 }]),
        ),
      },
    },
    policyAction: "start_monitor",
    riskLevel: "critical",
    annotations: {
      title: name,
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: (args, context) => context.dispatch(name, args),
  });
  return result;
}
