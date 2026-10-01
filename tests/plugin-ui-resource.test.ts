/**
 * Verifies the bundled stdio plugin exposes a usable MCP Apps resource.
 */

import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vitest";

const pluginRoot = resolve(process.env.PIO_AGENT_PLUGIN_ROOT ?? "plugins/platformio-mcp");

it("links the panel tool to a self-contained UI resource from the installed bundle", async () => {
  const client = new Client({ name: "pio-agent-ui-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(pluginRoot, "scripts/launch-platformio-mcp.mjs")],
    cwd: pluginRoot,
    env: { ...process.env, PIO_MCP_NO_BROWSER: "true" },
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const panelTool = tools.tools.find((tool) => tool.name === "open_pio_agent_panel");
    expect(panelTool?._meta?.ui).toEqual({ resourceUri: "ui://pio-agent/dashboard/v1.html" });
    expect(panelTool?._meta?.["openai/ui"]).toEqual({ entrypoints: [{ type: "thread" }] });
    expect(tools.tools.find((tool) => tool.name === "get_dashboard_url")?._meta?.ui).toBeUndefined();

    const openResult = await client.callTool({ name: "open_pio_agent_panel", arguments: {} });
    expect(openResult.content).toContainEqual(expect.objectContaining({ type: "text", text: expect.stringContaining('"status":"ready"') }));

    const resources = await client.listResources();
    expect(resources.resources.some((item) => item.uri === "ui://pio-agent/dashboard/v1.html")).toBe(true);
    const panel = await client.readResource({ uri: "ui://pio-agent/dashboard/v1.html" });
    expect(panel.contents[0]?.mimeType).toBe("text/html;profile=mcp-app");
    expect(panel.contents[0]?.text).toContain("pio-agent-root");
    expect(panel.contents[0]?.text).toContain("ui/initialize");
  } finally {
    await client.close();
  }
}, 30_000);
