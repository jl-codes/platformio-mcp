/** Opt-in package alias exposure through the real stdio server, without package or hardware execution. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vitest";
it.each([
  { entry: "index", mode: "off" },
  { entry: "index", mode: "flag" },
  { entry: "cli", mode: "flag" },
  { entry: "cli", mode: "environment" },
])(
  "keeps package aliases opt-in ($entry/$mode) and preserves all canonical tools",
  async ({ entry, mode }) => {
    const enabled = mode !== "off";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-compat-mcp-"));
    const state = fs.mkdtempSync(path.join(os.tmpdir(), "pio-compat-state-"));
    const client = new Client({ name: "compat-test", version: "1" });
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    delete environment.PIO_MCP_COMPAT;
    delete environment.PIO_MCP_POLICY_FILE;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        "--import",
        "tsx",
        path.resolve(`src/${entry}.ts`),
        ...(mode === "flag" ? ["--compat", "platformio-mcp-python"] : []),
      ],
      env: {
        ...environment,
        ...(mode === "environment"
          ? { PIO_MCP_COMPAT: "platformio-mcp-python" }
          : {}),
        PIO_MCP_DATA_DIR: state,
        PLATFORMIO_MCP_PROJECT_DIR: root,
      },
      stderr: "pipe",
    });
    try {
      fs.writeFileSync(
        path.join(root, "platformio.ini"),
        "[env:fixture]\nplatform=native\n",
      );
      fs.writeFileSync(
        path.join(root, ".pio-mcp-policy.json"),
        JSON.stringify({ profile: "read_only" }),
      );
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(enabled ? 97 : 57);
      expect(tools.some((tool) => tool.name === "pkg_install")).toBe(true);
      expect(tools.some((tool) => tool.name === "pio_pkg_install")).toBe(
        enabled,
      );
      for (const name of [
        "pio_list_boards",
        "pio_board_info",
        "pio_list_devices",
        "pio_monitor_list",
        "pio_monitor_stop",
        "pio_monitor_write",
        "pio_monitor_read",
        "pio_monitor_start",
        "pio_monitor_capture",
        "pio_memory_watch",
        "pio_power_profile",
        "pio_port_diagnose",
        "pio_decode_backtrace",
        "pio_size_report",
        "pio_project_init",
        "pio_clean",
        "pio_build",
        "pio_check",
        "pio_test",
        "pio_run_target",
        "pio_upload",
        "pio_system_info",
        "pio_partition_table",
        "pio_coredump",
        "pio_flash_and_verify",
        "pio_upload_ota",
        "pio_debug_start",
        "pio_debug_cmd",
        "pio_debug_list",
        "pio_debug_stop",
      ]) {
        expect(tools.some((tool) => tool.name === name)).toBe(enabled);
      }
      if (enabled) {
        const powerList = await client.callTool({
          name: "pio_power_profile",
          arguments: { operation: "list" },
        });
        expect(
          powerList.structuredContent,
          JSON.stringify(powerList),
        ).toMatchObject({
          ok: true,
          operations: [],
        });
        const invalidPower = await client.callTool({
          name: "pio_power_profile",
          arguments: { source: "ppk2", voltage_mv: 3300 },
        });
        expect(invalidPower.isError).toBe(true);
        const foreignPower = await client.callTool({
          name: "pio_power_profile",
          arguments: {
            operation: "cleanup",
            power_operation_id: "00000000-0000-4000-8000-000000000000",
          },
        });
        expect(JSON.stringify(foreignPower)).toContain(
          "POWER_OPERATION_NOT_FOUND",
        );
        const debugList = await client.callTool({
          name: "pio_debug_list",
          arguments: {},
        });
        expect(debugList.structuredContent).toMatchObject({
          ok: true,
          sessions: [],
        });
        const invalidDebug = await client.callTool({
          name: "pio_debug_start",
          arguments: { executable: "/untrusted/gdb" },
        });
        expect(invalidDebug.isError).toBe(true);
        expect(JSON.stringify(invalidDebug)).toContain(
          "COMPAT_ARGUMENT_INVALID",
        );
        const foreignDebug = await client.callTool({
          name: "pio_debug_cmd",
          arguments: {
            session_id: "00000000-0000-4000-8000-000000000000",
            command: "bt",
          },
        });
        expect(foreignDebug.isError).toBe(true);
        expect(JSON.stringify(foreignDebug)).toContain(
          "DEBUG_SESSION_NOT_FOUND",
        );
        const invalidOta = await client.callTool({
          name: "pio_upload_ota",
          arguments: { host: "board.local", auth: 123 },
        });
        expect(invalidOta.isError).toBe(true);
        expect(JSON.stringify(invalidOta)).toContain("COMPAT_ARGUMENT_INVALID");
        const invalidFlash = await client.callTool({
          name: "pio_flash_and_verify",
          arguments: { stop_open_sessions: "yes" },
        });
        expect(invalidFlash.isError).toBe(true);
        expect(JSON.stringify(invalidFlash)).toContain(
          "COMPAT_ARGUMENT_INVALID",
        );
        const invalidCoredump = await client.callTool({
          name: "pio_coredump",
          arguments: { analyze: "yes" },
        });
        expect(invalidCoredump.isError).toBe(true);
        expect(JSON.stringify(invalidCoredump)).toContain(
          "COMPAT_ARGUMENT_INVALID",
        );
        const result = await client.callTool({
          name: "pio_pkg_install",
          arguments: { spec: "owner/package" },
        });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).toContain("POLICY_DENIED");
        expect(result.structuredContent).toMatchObject({
          ok: false,
          error: "policy_denied",
          status: "failed",
        });
        const invalidDeps = await client.callTool({
          name: "pio_deps_check",
          arguments: { approved: true },
        });
        expect(invalidDeps.isError).toBe(true);
        expect(JSON.stringify(invalidDeps)).toContain(
          "COMPAT_ARGUMENT_INVALID",
        );
        const metadata = await client.callTool({
          name: "pio_project_metadata",
          arguments: {},
        });
        expect(metadata.isError).toBe(true);
        expect(JSON.stringify(metadata)).toContain("POLICY_DENIED");
        const targets = await client.callTool({
          name: "pio_list_targets",
          arguments: {},
        });
        expect(targets.isError).toBe(true);
        expect(JSON.stringify(targets)).toContain("POLICY_DENIED");
        expect(tools.some((tool) => tool.name === "pio_project_envs")).toBe(
          true,
        );
      }
    } finally {
      await client.close();
      await transport.close();
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(state, { recursive: true, force: true });
    }
  },
  20000,
);
