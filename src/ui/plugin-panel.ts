/**
 * PIO Agent MCP Apps resource served from the bundled plugin runtime.
 *
 * Provides:
 * - PIO_AGENT_PANEL_URI: Versioned resource identity for the native panel.
 * - readPioAgentPanel: Returns self-contained HTML for an MCP Apps host.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

/** A new URI is required when the panel's HTML or bridge contract changes. */
export const PIO_AGENT_PANEL_URI = "ui://pio-agent/dashboard/v1.html";

/**
 * Reads the prebuilt panel from the installed runtime, independent of source checkout.
 * @returns MCP resource contents containing self-contained HTML and JavaScript.
 */
export function readPioAgentPanel() {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const webRoot = process.env.PIO_MCP_WEB_DIST || join(moduleDir, "..", "web", "dist");
  const component = readFileSync(join(webRoot, "pio-agent-panel.js"), "utf8");
  const safeComponent = component.replaceAll("</script", "<\\/script");
  return {
    contents: [{
      uri: PIO_AGENT_PANEL_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PIO Agent</title></head><body><main id="pio-agent-root"></main><script type="module">${safeComponent}</script></body></html>`,
      _meta: { ui: { prefersBorder: true } },
    }],
  };
}
