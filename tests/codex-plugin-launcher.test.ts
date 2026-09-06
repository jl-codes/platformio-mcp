/**
 * Cross-platform launcher tests for the packaged PlatformIO MCP server.
 */

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { getLaunchSpec } from "../plugins/platformio-mcp/scripts/launch-platformio-mcp.mjs";

const PLUGIN_ROOT = path.join(process.cwd(), "plugins", "platformio-mcp");
const RUNTIME_PATH = path.join(PLUGIN_ROOT, "runtime", "platformio-mcp.mjs");

describe("Codex plugin launcher", () => {
  it("prefers the self-contained runtime and disables OS browser launch", () => {
    const spec = getLaunchSpec({
      pluginRoot: PLUGIN_ROOT,
      runtimeExists: true,
    });

    expect(spec.source).toBe("bundled");
    expect(spec.command).toBe(process.execPath);
    expect(spec.args[0]).toBe(
      path.join(PLUGIN_ROOT, "runtime", "platformio-mcp.mjs"),
    );
    expect(spec.env.PIO_MCP_NO_BROWSER).toBe("true");
    expect(spec.env.PIO_MCP_WEB_DIST).toBe(
      path.join(PLUGIN_ROOT, "runtime", "web"),
    );
  });

  it("uses a version-pinned Windows npm fallback", () => {
    const spec = getLaunchSpec({
      pluginRoot: PLUGIN_ROOT,
      platform: "win32",
      runtimeExists: false,
    });

    expect(spec.source).toBe("npm");
    expect(spec.command).toBe("npx.cmd");
    expect(spec.args.slice(0, 2)).toEqual(["-y", "platformio-mcp@2.2.2"]);
  });

  it("uses the portable npm executable on non-Windows hosts", () => {
    const spec = getLaunchSpec({
      pluginRoot: PLUGIN_ROOT,
      platform: "linux",
      runtimeExists: false,
    });

    expect(spec.command).toBe("npx");
  });
});

const describeBundledRuntime = fs.existsSync(RUNTIME_PATH)
  ? describe
  : describe.skip;

describeBundledRuntime("bundled Codex plugin runtime", () => {
  it("initializes from a cache-like copy and lists every public tool", async () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "pio-mcp-codex-plugin-"),
    );
    const copiedPluginRoot = path.join(temporaryRoot, "platformio-mcp");
    fs.cpSync(PLUGIN_ROOT, copiedPluginRoot, { recursive: true });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        path.join(copiedPluginRoot, "scripts", "launch-platformio-mcp.mjs"),
      ],
      stderr: "pipe",
      env: {
        ...process.env,
        PIO_MCP_NO_BROWSER: "true",
        PIO_MCP_PLUGIN_DEBUG: "true",
      },
    });
    const client = new Client(
      { name: "codex-plugin-smoke-test", version: "1.0.0" },
      { capabilities: {} },
    );
    let stderr = "";
    transport.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    try {
      await client.connect(transport).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}\nPackaged server stderr:\n${stderr}`);
      });
      const result = await client.listTools();
      expect(result.tools).toHaveLength(42);
      expect(
        result.tools.every(
          (tool) =>
            tool.annotations &&
            typeof tool.annotations.readOnlyHint === "boolean" &&
            typeof tool.annotations.destructiveHint === "boolean" &&
            typeof tool.annotations.idempotentHint === "boolean" &&
            typeof tool.annotations.openWorldHint === "boolean",
        ),
      ).toBe(true);
      expect(result.tools.map((tool) => tool.name)).toContain(
        "get_dashboard_url",
      );
      expect(result.tools.map((tool) => tool.name)).toContain(
        "agent_flash_monitor_verify",
      );
      expect(result.tools.map((tool) => tool.name)).toContain(
        "agent_monitor_health",
      );
    } finally {
      await client.close();
      await transport.close();
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 20_000);
});
