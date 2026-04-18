import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const WORKSPACE_DIR = ".pio-mcp-workspace";

/**
 * Persist centralized observability forensics across the server lifecycle.
 * Writes to the `.pio-mcp-workspace/mcp-internal.log` bound natively into
 * whichever dynamically executed environment the MCP is targeting.
 */
export async function logDiagnostic(msg: string, projectDir?: string) {
  const baseDir = projectDir || os.tmpdir();
  const workspaceDir = path.join(baseDir, WORKSPACE_DIR);
  const diagLog = path.join(workspaceDir, "mcp-internal.log");
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  
  if (!fs.existsSync(workspaceDir)) {
    try {
      fs.mkdirSync(workspaceDir, { recursive: true });
    } catch {
      // Graceful fallback if we can't create the directory
    }
  }

  try {
    await fs.promises.appendFile(diagLog, line);
  } catch {
    // Fail silently in production if file permissions block tracing
  }
  
  // Keep stdout free for JSON-RPC, emit to stderr natively.
  console.error(msg);
}
