/**
 * Installer for Google Antigravity.
 *
 * Antigravity reads MCP server definitions from
 * ~/.gemini/antigravity/mcp_config.json. We use the npx-based command block
 * because the user installed `platformio-mcp` via npm — `npx` is on PATH and
 * does not need a shell wrapper.
 */
import path from "node:path";
import os from "node:os";
import { mergeMcpConfig } from "./_shared.js";

export async function installAntigravity() {
  const target = path.join(
    os.homedir(),
    ".gemini",
    "antigravity",
    "mcp_config.json",
  );
  const r = mergeMcpConfig(target);
  console.log(`✅ Antigravity config ${r.action} at: ${r.path}`);
  console.log(
    `\nNext: relaunch Antigravity. The dashboard auto-opens on first MCP boot.`,
  );
}
