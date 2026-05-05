/**
 * Installer for VS Code's native MCP support.
 *
 * VS Code (1.95+) reads MCP server definitions from `.vscode/mcp.json`
 * relative to the workspace root. Per VS Code's design, this is intentionally
 * a per-workspace file rather than a global one — each project opts in.
 */
import path from "node:path";
import { mergeMcpConfig } from "./_shared.js";

export async function installVscode() {
  const target = path.join(process.cwd(), ".vscode", "mcp.json");
  const r = mergeMcpConfig(target, "platformio");
  console.log(`✅ VS Code workspace config ${r.action} at: ${r.path}`);
  console.log(
    `\nNext: open this folder in VS Code. The dashboard auto-opens on first MCP boot.`,
  );
}
