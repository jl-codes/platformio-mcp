/**
 * Workspace Registry
 * Maintains a persistent log of workspaces targeted by the MCP server.
 * Uses proper-lockfile to prevent read-modify-write data races 
 * between parallel agents on the same host.
 */

import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import { SERVER_DATA_DIR, ensureGlobalDirs } from "./paths.js";

const REGISTRY_FILE = path.join(SERVER_DATA_DIR, "workspaces.json");

export interface WorkspaceRecord {
  dir: string;
  timestamp: number;
}

/**
 * Ensures the JSON array file exists.
 */
function ensureRegistryFile(): void {
  ensureGlobalDirs();
  if (!fs.existsSync(REGISTRY_FILE)) {
    fs.writeFileSync(REGISTRY_FILE, "[]");
  }
}

/**
 * Appends a workspace directory to the tracking log.
 * De-duplicates adjacent identical calls during rapid sequential operations.
 */
export async function addWorkspace(dir: string): Promise<void> {
  ensureRegistryFile();

  try {
    const release = await lockfile.lock(REGISTRY_FILE, { retries: { retries: 5, minTimeout: 50, maxTimeout: 200 } });
    try {
      let records: WorkspaceRecord[] = [];
      try {
        records = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
      } catch {}

      if (records.length > 0) {
        const lastRecord = records[records.length - 1];
        if (lastRecord.dir === dir) {
          return; // Already the latest, skip
        }
      }

      records.push({ dir, timestamp: Date.now() });
      fs.writeFileSync(REGISTRY_FILE, JSON.stringify(records, null, 2));
    } finally {
      await release();
    }
  } catch {
    // Fail silently on timeout so we don't crash the server
  }
}

/**
 * Reads and deduplicates the registry, returning a chronologically ordered array
 * of unique absolute workspace paths (oldest to most recent).
 */
export async function getWorkspaces(): Promise<string[]> {
  ensureRegistryFile();

  let records: WorkspaceRecord[] = [];
  try {
    const release = await lockfile.lock(REGISTRY_FILE, { retries: { retries: 5, minTimeout: 50, maxTimeout: 200 } });
    try {
      records = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
    } finally {
      await release();
    }
  } catch {
    try {
      records = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8")); // Fallback read
    } catch {
      return [];
    }
  }

  const seen = new Map<string, number>();
  for (const parsed of records) {
    if (parsed.dir) {
      seen.set(parsed.dir, parsed.timestamp);
    }
  }

  return Array.from(seen.entries())
    .sort((a, b) => a[1] - b[1])
    .map(entry => entry[0]);
}

/**
 * Completely rewrites the JSON registry, removing defunct entries.
 * Given an array of ordered directory paths, it drops the current 
 * transaction log and sequences them back in order.
 */
export async function rewriteRegistry(directories: string[]): Promise<void> {
  ensureRegistryFile();
  
  try {
    const release = await lockfile.lock(REGISTRY_FILE, { retries: { retries: 5, minTimeout: 50, maxTimeout: 200 } });
    try {
      const records = directories.map(dir => ({ dir, timestamp: Date.now() }));
      fs.writeFileSync(REGISTRY_FILE, JSON.stringify(records, null, 2));
    } finally {
      await release();
    }
  } catch {}
}
