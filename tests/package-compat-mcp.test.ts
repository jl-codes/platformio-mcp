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
        PIO_MCP_DATA_DIR: path.join(root, "state"),
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
      expect(tools).toHaveLength(enabled ? 74 : 54);
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
      ]) {
        expect(tools.some((tool) => tool.name === name)).toBe(enabled);
      }
      if (enabled) {
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
    }
  },
  20000,
);
