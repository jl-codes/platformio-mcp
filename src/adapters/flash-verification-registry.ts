/** Expose retained flash verification in normal mode and under the opt-in reference alias. */
import { FlashVerificationCompatibilitySchema } from "./flash-verification-compat.js";
import type { RegisteredTool } from "../mcp/tool-registry.js";

/** Keep advertised fields and scoped approvals identical across the two entrypoints. */
export function withFlashVerificationTools<TResult>(
  base: ReadonlyMap<string, RegisteredTool<TResult>>,
  name: "flash_verification" | "pio_flash_and_verify" = "flash_verification",
): ReadonlyMap<string, RegisteredTool<TResult>> {
  const result = new Map(base);
  const flashVerify = base.get("agent_flash_monitor_verify");
  if (!flashVerify || result.has(name))
    throw new Error("Invalid flash verification compatibility registry");
  const flashDefaults = FlashVerificationCompatibilitySchema.parse({});
  result.set(name, {
    ...flashVerify,
    name,
    description:
      "Build and upload firmware, verify fresh owned serial boot output, and decode crashes when authorized. Preserves quiet-window/crash checks; reports incomplete evidence and unverified firmware identity explicitly.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        resume_id: { type: "string", format: "uuid" },
        project_dir: { type: ["string", "null"], default: null },
        env: { type: ["string", "null"], default: null },
        expect: {
          type: "string",
          maxLength: 4096,
          default: flashDefaults.expect,
        },
        fail_on: {
          type: "string",
          maxLength: 4096,
          default: flashDefaults.fail_on,
        },
        timeout_s: { type: "number", minimum: 0, maximum: 300, default: 30 },
        upload_port: { type: ["string", "null"], default: null },
        monitor_port: { type: ["string", "null"], default: null },
        baud: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: 4000000,
          default: null,
        },
        stop_open_sessions: { type: "boolean", default: false },
        max_lines: {
          type: "integer",
          minimum: 1,
          maximum: 10000,
          default: 500,
        },
        settle_s: { type: "number", minimum: 0, maximum: 20, default: 1.5 },
        stability_window_s: {
          type: "number",
          minimum: 0,
          maximum: 60,
          default: 10,
        },
        ...Object.fromEntries(
          [
            "manifest_approval_id",
            "system_approval_id",
            "workflow_approval_id",
            "approval_id",
            "config_approval_id",
            "selection_approval_id",
            "monitor_approval_id",
            "read_approval_id",
            "preflight_discovery_approval_id",
            "discovery_approval_id",
            "decode_approval_id",
            "decode_config_approval_id",
          ].map((name) => [name, { type: "string", maxLength: 256 }]),
        ),
      },
    },
    handler: (args, context) => context.dispatch(name, args),
  });
  return result;
}
