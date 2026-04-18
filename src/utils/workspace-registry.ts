/**
 * Workspace Registry
 * Maintains a persistent log of workspaces targeted by the MCP server.
 * Uses a JSONL append-only structure to prevent read-modify-write data races 
 * between parallel agents on the same host.
 */

import fs from "node:fs";
import path from "node:path";
import { SERVER_STATE_DIR, ensureDir } from "./paths.js";

const REGISTRY_FILE = path.join(SERVER_STATE_DIR, "workspaces.jsonl");

export interface WorkspaceRecord {
  dir: string;
  timestamp: number;
}

/**
 * Appends a workspace directory to the tracking log.
 * De-duplicates adjacent identical calls during rapid sequential operations.
 */
export function addWorkspace(dir: string): void {
  ensureDir(SERVER_STATE_DIR);
  
  if (fs.existsSync(REGISTRY_FILE)) {
    try {
      // Basic optimization: don't append if the exact same dir is already the very last line
      const fd = fs.openSync(REGISTRY_FILE, "r");
      const stat = fs.fstatSync(fd);
      if (stat.size > 0) {
        // Read tail chunk
        const chunkSize = Math.min(stat.size, 1024);
        const buffer = Buffer.alloc(chunkSize);
        fs.readSync(fd, buffer, 0, chunkSize, stat.size - chunkSize);
        
        const content = buffer.toString("utf8");
        const lines = content.trimEnd().split("\n");
        const lastLine = lines[lines.length - 1];
        
        if (lastLine) {
          const parsed = JSON.parse(lastLine) as WorkspaceRecord;
          if (parsed.dir === dir) {
            fs.closeSync(fd);
            return; // Already the latest, skip append
          }
        }
      }
      fs.closeSync(fd);
    } catch {
      // On any read race/error, safely default to appending
    }
  }

  const record: WorkspaceRecord = { dir, timestamp: Date.now() };
  fs.appendFileSync(REGISTRY_FILE, JSON.stringify(record) + "\n");
}

/**
 * Reads and deduplicates the registry, returning a chronologically ordered array
 * of unique absolute workspace paths (oldest to most recent).
 */
export function getWorkspaces(): string[] {
  if (!fs.existsSync(REGISTRY_FILE)) {
    return [];
  }

  try {
    const lines = fs.readFileSync(REGISTRY_FILE, "utf8").split("\n").filter(l => l.trim().length > 0);
    const seen = new Map<string, number>();

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as WorkspaceRecord;
        if (parsed.dir) {
          seen.set(parsed.dir, parsed.timestamp);
        }
      } catch {
        continue;
      }
    }

    // Sort by timestamp ascending
    return Array.from(seen.entries())
      .sort((a, b) => a[1] - b[1])
      .map(entry => entry[0]);
  } catch {
    return [];
  }
}
