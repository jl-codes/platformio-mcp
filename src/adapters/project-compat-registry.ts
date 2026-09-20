/** Register opt-in project aliases while preserving canonical permission metadata. */
import { FlashVerificationCompatibilitySchema } from "./flash-verification-compat.js";
import type { RegisteredTool } from "../mcp/tool-registry.js";

/** Extend a canonical registry without changing its entries or granting additional permissions. */
export function withProjectCompatibility<TResult>(
  base: ReadonlyMap<string, RegisteredTool<TResult>>,
): ReadonlyMap<string, RegisteredTool<TResult>> {
  const result = new Map(base);
  for (const canonical of [
    "project_envs",
    "project_metadata",
    "list_targets",
  ]) {
    const name = `pio_${canonical}`;
    const source = base.get(canonical);
    if (!source || result.has(name))
      throw new Error(`Invalid compatibility mapping: ${name}`);
    const properties: Record<string, unknown> = {
      project_dir: {
        anyOf: [{ type: "string" }, { type: "null" }],
        default: null,
      },
      approval_id: {
        type: "string",
        description: "Optional scoped canonical approval identifier.",
      },
    };
    if (canonical !== "project_envs")
      properties.env = {
        anyOf: [{ type: "string" }, { type: "null" }],
        default: null,
      };
    result.set(name, {
      ...source,
      name,
      description: `Compatibility alias for ${canonical}. Uses the same server permissions and project implementation.`,
      inputSchema: {
        type: "object",
        properties,
        required: [],
        additionalProperties: false,
      },
      handler: (args, context) => context.dispatch(name, args),
    });
  }
  const coredump = base.get("coredump");
  if (!coredump || result.has("pio_coredump"))
    throw new Error("Invalid core-dump compatibility registry");
  result.set("pio_coredump", {
    ...coredump,
    name: "pio_coredump",
    description:
      "Capture and save the selected ESP core-dump partition, optionally analyzing it against the matching project ELF. Configuration, metadata, device, export and analysis permissions remain separate.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_dir: { type: ["string", "null"], default: null },
        env: { type: ["string", "null"], default: null },
        port: { type: ["string", "null"], default: null },
        out_path: { type: ["string", "null"], default: null },
        analyze: { type: "boolean", default: true },
        elf_path: { type: "string" },
        table_path: { type: "string" },
        table_offset: { type: "integer", minimum: 0, maximum: 4294963200 },
        sdkconfig_path: { type: "string" },
        build_metadata: { type: "boolean", default: true },
        ...Object.fromEntries(
          [
            "approval_id",
            "config_approval_id",
            "selection_approval_id",
            "elf_metadata_approval_id",
            "table_approval_id",
            "table_config_approval_id",
            "metadata_approval_id",
            "system_approval_id",
            "board_approval_id",
            "read_approval_id",
            "read_command_approval_id",
            "command_approval_id",
            "export_approval_id",
          ].map((name) => [name, { type: "string", maxLength: 256 }]),
        ),
      },
    },
    handler: (args, context) => context.dispatch("pio_coredump", args),
  });
  const partition = base.get("partition_table");
  if (!partition || result.has("pio_partition_table"))
    throw new Error("Invalid partition compatibility registry");
  result.set("pio_partition_table", {
    ...partition,
    name: "pio_partition_table",
    description:
      "Inspect the effective ESP partition layout and optionally compare a serial device. Build metadata and hardware access retain separate canonical permissions.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_dir: { type: ["string", "null"], default: null },
        env: { type: ["string", "null"], default: null },
        read_device: { type: "boolean", default: false },
        port: { type: ["string", "null"], default: null },
        build_metadata: { type: "boolean", default: true },
        table_path: { type: "string" },
        table_offset: { type: "integer", minimum: 0, maximum: 4294963200 },
        sdkconfig_path: { type: "string" },
        firmware_path: { type: "string" },
        approval_id: { type: "string" },
        config_approval_id: { type: "string" },
        metadata_approval_id: { type: "string" },
        system_approval_id: { type: "string" },
        board_approval_id: { type: "string" },
        selection_approval_id: { type: "string" },
        read_approval_id: { type: "string" },
        command_approval_id: { type: "string" },
      },
    },
    handler: (args, context) => context.dispatch("pio_partition_table", args),
  });
  const init = base.get("init_project");
  if (!init || result.has("pio_project_init"))
    throw new Error("Invalid init compatibility registry");
  result.set("pio_project_init", {
    ...init,
    name: "pio_project_init",
    description:
      "Initialize a PlatformIO project with ordered options. Canonical initialization and configuration-read permissions apply before filesystem changes.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["project_dir", "board"],
      properties: {
        project_dir: { type: "string", minLength: 1, maxLength: 32768 },
        board: { type: "string", minLength: 1, maxLength: 256 },
        framework: { type: ["string", "null"] },
        project_options: {
          type: ["array", "null"],
          maxItems: 128,
          items: { type: "string", maxLength: 4096 },
        },
        approval_id: { type: "string", maxLength: 256 },
        config_approval_id: { type: "string", maxLength: 256 },
      },
    },
    handler: (args, context) => context.dispatch("pio_project_init", args),
  });
  const clean = base.get("clean_project");
  if (!clean || result.has("pio_clean"))
    throw new Error("Invalid clean compatibility registry");
  result.set("pio_clean", {
    ...clean,
    name: "pio_clean",
    description:
      "Clean selected build artifacts, optionally including dependencies. Canonical destructive cleanup permission applies.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_dir: { type: ["string", "null"], maxLength: 32768 },
        env: { type: ["string", "null"], pattern: "^[a-zA-Z0-9_-]{1,50}$" },
        full: { type: "boolean", default: false },
        approval_id: { type: "string", maxLength: 256 },
      },
    },
    handler: (args, context) => context.dispatch("pio_clean", args),
  });
  const build = base.get("build_project");
  if (!build || result.has("pio_build"))
    throw new Error("Invalid build compatibility registry");
  result.set("pio_build", {
    ...build,
    name: "pio_build",
    description:
      "Run a fresh PlatformIO build with optional parallel jobs and compact diagnostics. Canonical build permissions apply.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_dir: { type: ["string", "null"], maxLength: 32768 },
        env: { type: ["string", "null"], pattern: "^[a-zA-Z0-9_-]{1,50}$" },
        jobs: { type: ["integer", "null"], minimum: 1, maximum: 1024 },
        verbose: { type: "boolean", default: false },
        approval_id: { type: "string", maxLength: 256 },
      },
    },
    handler: (args, context) => context.dispatch("pio_build", args),
  });
  const check = base.get("check_project");
  if (!check || result.has("pio_check"))
    throw new Error("Invalid check compatibility registry");
  result.set("pio_check", {
    ...check,
    name: "pio_check",
    description:
      "Run static analysis with structured defects, source locations and CWE. Canonical check permissions apply.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_dir: { type: ["string", "null"], maxLength: 32768 },
        env: { type: ["string", "null"], pattern: "^[a-zA-Z0-9_-]{1,50}$" },
        severity: {
          type: "string",
          enum: ["low", "medium", "high"],
          default: "medium",
        },
        pattern: { type: ["string", "null"], minLength: 1, maxLength: 4096 },
        skip_packages: { type: "boolean", default: true },
        tool: { type: ["string", "null"], minLength: 1, maxLength: 4096 },
        approval_id: { type: "string", maxLength: 256 },
      },
    },
    handler: (args, context) => context.dispatch("pio_check", args),
  });
  const test = base.get("run_tests");
  if (!test || result.has("pio_test"))
    throw new Error("Invalid test compatibility registry");
  result.set("pio_test", {
    ...test,
    name: "pio_test",
    description:
      "Run PlatformIO tests with per-case results. Embedded tests can upload and open hardware; canonical high-risk test permission applies. Build-only policy disables upload and test execution.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_dir: { type: ["string", "null"], maxLength: 32768 },
        env: { type: ["string", "null"], pattern: "^[a-zA-Z0-9_-]{1,50}$" },
        filter: { type: ["string", "null"], minLength: 1, maxLength: 4096 },
        ignore: { type: ["string", "null"], minLength: 1, maxLength: 4096 },
        without_uploading: { type: "boolean", default: false },
        without_building: { type: "boolean", default: false },
        upload_port: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 4096,
        },
        verbose: { type: "boolean", default: false },
        approval_id: { type: "string", maxLength: 256 },
      },
    },
    handler: (args, context) => context.dispatch("pio_test", args),
  });
  const target = base.get("run_target");
  if (!target || result.has("pio_run_target"))
    throw new Error("Invalid named target compatibility registry");
  result.set("pio_run_target", {
    ...target,
    name: "pio_run_target",
    description:
      "Run a named target through the canonical effect permissions and caller-owned serial lifecycle.",
    inputSchema: {
      type: "object",
      required: ["target"],
      additionalProperties: false,
      properties: {
        target: { type: "string" },
        project_dir: { type: ["string", "null"], default: null },
        env: { type: ["string", "null"], default: null },
        upload_port: { type: ["string", "null"], default: null },
        stop_open_sessions: { type: "boolean", default: false },
        approval_id: { type: "string" },
        config_approval_id: { type: "string" },
        selection_approval_id: { type: "string" },
      },
    },
    handler: (args, context) => context.dispatch("pio_run_target", args),
  });
  const flashVerify = base.get("agent_flash_monitor_verify");
  if (!flashVerify || result.has("pio_flash_and_verify"))
    throw new Error("Invalid flash verification compatibility registry");
  const flashDefaults = FlashVerificationCompatibilitySchema.parse({});
  result.set("pio_flash_and_verify", {
    ...flashVerify,
    name: "pio_flash_and_verify",
    description:
      "Build and upload firmware, verify fresh owned serial boot output, and decode crashes when authorized. Preserves quiet-window/crash checks; reports incomplete evidence and unverified firmware identity explicitly.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
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
    handler: (args, context) => context.dispatch("pio_flash_and_verify", args),
  });
  const ota = base.get("upload_firmware");
  if (!ota || result.has("pio_upload_ota"))
    throw new Error("Invalid OTA compatibility registry");
  result.set("pio_upload_ota", {
    ...ota,
    name: "pio_upload_ota",
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
    handler: (args, context) => context.dispatch("pio_upload_ota", args),
  });
  const upload = base.get("upload_firmware");
  if (!upload || result.has("pio_upload"))
    throw new Error("Invalid firmware upload compatibility registry");
  result.set("pio_upload", {
    ...upload,
    name: "pio_upload",
    description:
      "Build and upload firmware through shared upload permissions and caller-owned serial cleanup.",
    inputSchema: {
      type: "object",
      required: [],
      additionalProperties: false,
      properties: {
        project_dir: { type: ["string", "null"], default: null },
        env: { type: ["string", "null"], default: null },
        upload_port: { type: ["string", "null"], default: null },
        stop_open_sessions: { type: "boolean", default: false },
        approval_id: { type: "string" },
        config_approval_id: { type: "string" },
        selection_approval_id: { type: "string" },
      },
    },
    handler: (args, context) => context.dispatch("pio_upload", args),
  });
  const system = base.get("system_info");
  if (!system || result.has("pio_system_info"))
    throw new Error("Invalid system compatibility registry");
  result.set("pio_system_info", {
    ...system,
    name: "pio_system_info",
    description:
      "Inspect PlatformIO Core, effective server policy and caller-owned monitors through canonical permissions.",
    inputSchema: {
      type: "object",
      required: [],
      additionalProperties: false,
      properties: {
        approval_id: { type: "string" },
        policy_approval_id: { type: "string" },
        monitor_approval_id: { type: "string" },
      },
    },
    handler: (args, context) => context.dispatch("pio_system_info", args),
  });
  return result;
}
