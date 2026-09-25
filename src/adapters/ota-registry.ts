/** Expose one OTA implementation under its canonical name and optional reference vocabulary. */
import type { RegisteredTool } from "../mcp/tool-registry.js";

/** Canonical and compatibility entries share arguments, result shape and upload authorization. */
export function withOtaTools<TResult>(
  base: ReadonlyMap<string, RegisteredTool<TResult>>,
  name: "upload_ota" | "pio_upload_ota" = "upload_ota",
): ReadonlyMap<string, RegisteredTool<TResult>> {
  const result = new Map(base);
  const ota = base.get("upload_firmware");
  if (!ota || result.has(name))
    throw new Error("Invalid OTA compatibility registry");
  result.set(name, {
    ...ota,
    name,
    annotations: { ...ota.annotations, openWorldHint: true },
    description:
      "Upload ESP32/ESP8266 firmware or filesystem images over ArduinoOTA using a fixed network target, immutable image and private credentials. Build and uploader permissions are separate; transfer success does not verify runtime health.",
    inputSchema: {
      type: "object",
      required: ["host"],
      additionalProperties: false,
      properties: {
        host: { type: "string", minLength: 1, maxLength: 253 },
        project_dir: { type: ["string", "null"], default: null },
        env: { type: ["string", "null"], default: null },
        port: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: 65535,
          default: null,
        },
        auth: { type: ["string", "null"], maxLength: 1024, default: null },
        filesystem: { type: "boolean", default: false },
        build: { type: "boolean", default: true },
        timeout_s: {
          type: "number",
          minimum: 0.001,
          maximum: 600,
          default: 180,
        },
        verify_reachable: { type: "boolean", default: true },
        image_path: { type: "string" },
        elf_path: { type: "string", minLength: 1, maxLength: 32768 },
        expected_image_sha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
        ...Object.fromEntries(
          [
            "approval_id",
            "command_approval_id",
            "config_approval_id",
            "build_approval_id",
            "image_approval_id",
            "system_approval_id",
            "resolve_approval_id",
          ].map((name) => [name, { type: "string", maxLength: 256 }]),
        ),
      },
    },
    handler: (args, context) => context.dispatch(name, args),
  });
  return result;
}
