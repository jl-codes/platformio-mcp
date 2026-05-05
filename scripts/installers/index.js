/**
 * Installer dispatcher.
 *
 * Routes `platformio-mcp install --<target>` to the appropriate per-host
 * installer module. Targets:
 *   --cline       Cline (VS Code extension or CLI)
 *   --claude      Claude Desktop
 *   --vscode      VS Code native MCP support
 *   --antigravity Google Antigravity
 */
import { installCline } from "./cline.js";
import { installClaude } from "./claude.js";
import { installVscode } from "./vscode.js";
import { installAntigravity } from "./antigravity.js";

const VALID_TARGETS = ["cline", "claude", "vscode", "antigravity"];

export async function runInstaller(target) {
  switch (target) {
    case "cline":
      return installCline();
    case "claude":
      return installClaude();
    case "vscode":
      return installVscode();
    case "antigravity":
      return installAntigravity();
    default:
      console.error(
        `Unknown installer target: --${target}. Valid: ${VALID_TARGETS.map((t) => "--" + t).join(", ")}`,
      );
      process.exit(1);
  }
}
