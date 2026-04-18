import fs from "node:fs";
import path from "node:path";
import { SERVER_DATA_DIR, ensureGlobalDirs } from "./paths.js";

/**
 * Persist centralized observability forensics across the server lifecycle.
 * Writes to the global server data directory `server.log`.
 */
export async function logDiagnostic(msg: string, _projectDir?: string) {
  ensureGlobalDirs();
  const diagLog = path.join(SERVER_DATA_DIR, "server.log");
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  
  try {
    await fs.promises.appendFile(diagLog, line);
  } catch {
    // Fail silently in production if file permissions block tracing
  }
  
  // Keep stdout free for JSON-RPC, emit to stderr natively.
  console.error(msg);
}
