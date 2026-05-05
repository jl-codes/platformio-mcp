/**
 * Installer for Claude Desktop.
 *
 * Claude Desktop reads its MCP server registry from a JSON file in the
 * platform's roaming app-data directory:
 *   macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json
 *   Windows: %APPDATA%\Claude\claude_desktop_config.json
 *   Linux:   ~/.config/Claude/claude_desktop_config.json (community builds)
 */
import path from "node:path";
import { mergeMcpConfig, appDataDir } from "./_shared.js";

export async function installClaude() {
  const target = path.join(
    appDataDir(),
    "Claude",
    "claude_desktop_config.json",
  );
  const r = mergeMcpConfig(target);
  console.log(`✅ Claude Desktop config ${r.action} at: ${r.path}`);
  console.log(
    `\nNext: fully quit and relaunch Claude Desktop. The dashboard auto-opens on first MCP boot.`,
  );
}
