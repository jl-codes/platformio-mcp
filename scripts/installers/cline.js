/**
 * Installer for Cline.
 *
 * Cline ships as both a VS Code extension (saoudrizwan.claude-dev) and a CLI.
 * The VS Code extension reads its MCP server registry from a settings file
 * inside VS Code's globalStorage. The CLI reads from ~/.cline/mcp_servers.json.
 *
 * We write to whichever target directories already exist, defaulting to the
 * VS Code extension path when neither has been used yet.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { mergeMcpConfig, appDataDir } from "./_shared.js";

export async function installCline() {
  // VS Code's user data folder name is "Code" on every supported platform
  // (Stable channel). VS Code Insiders would be "Code - Insiders" but is rare.
  const vscodeGlobal = path.join(
    appDataDir(),
    "Code",
    "User",
    "globalStorage",
    "saoudrizwan.claude-dev",
    "settings",
    "cline_mcp_settings.json",
  );

  // Cline CLI alternative location
  const clineCli = path.join(os.homedir(), ".cline", "mcp_servers.json");

  const targets = [];
  // If either target's parent already exists (because the user has used Cline
  // before), write to it. Otherwise default to the VS Code extension path.
  if (fs.existsSync(path.dirname(vscodeGlobal))) targets.push(vscodeGlobal);
  if (fs.existsSync(path.dirname(clineCli))) targets.push(clineCli);
  if (targets.length === 0) targets.push(vscodeGlobal);

  for (const t of targets) {
    const r = mergeMcpConfig(t);
    console.log(`✅ Cline config ${r.action} at: ${r.path}`);
  }
  console.log(
    `\nNext: reload Cline. The dashboard will auto-open the next time the MCP server boots.`,
  );
}
