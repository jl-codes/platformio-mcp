/**
 * Command Registry Utility
 * Manages an append-only (or rotating) chronologically-ordered feed of background platformio events.
 *
 * Provides:
 * - registerCommand: Records a new command execution to the registry.
 * - updateCommandStatus: Modifies the status or exit details of an existing command.
 * - getCommandHistory: Retrieves the list of historically executing commands.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import lockfile from "proper-lockfile";
import { portalEvents } from "../api/events.js";

const WORKSPACE_DIR = ".pio-mcp-workspace";
const REGISTRY_FILE = "command_history.json";
const MAX_HISTORY_ITEMS = 30;

function getRegistryFilePath(projectDir?: string): string {
  const baseDir = projectDir || os.tmpdir();
  const dir = path.join(baseDir, WORKSPACE_DIR, "registry");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, REGISTRY_FILE);
}

/**
 * Historical record of an executed command spanning builds or serial monitors.
 */
export interface CommandRecord {
  id: string; // Unique identifier for the command
  timestamp: number; // Start time epoch
  type: "build" | "monitor"; // Classification of the command
  status: "running" | "success" | "error" | "terminated"; // Current process status
  logFile?: string; // Optional pointer to disk-spooled output log
  port?: string; // Optional context for monitor commands
  pid?: number; // Optional system PID
  exitCode?: number; // OS exit signal result
}

/**
 * Appends a new command record into the workspace command history.
 * @param record Initial status details of the command being spun up
 * @param projectDir Optional specific workspace
 */
export async function registerCommand(record: CommandRecord, projectDir?: string): Promise<void> {
  const file = getRegistryFilePath(projectDir);
  if (!fs.existsSync(file)) fs.writeFileSync(file, "[]");

  try {
    const release = await lockfile.lock(file, { retries: { retries: 5, minTimeout: 50, maxTimeout: 200 } });
    try {
      let history: CommandRecord[] = [];
      try {
        history = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {}

      history.push(record);
      // Keep only up to 30 items
      if (history.length > MAX_HISTORY_ITEMS) {
        history = history.slice(-MAX_HISTORY_ITEMS);
      }

      fs.writeFileSync(file, JSON.stringify(history, null, 2));
      portalEvents.emitCommandHistoryUpdated(projectDir || os.tmpdir());
    } finally {
      await release();
    }
  } catch (e: any) {
    throw new Error(`Registry contention timeout: ${e.message}`);
  }
}

/**
 * Searches and updates the fields of a given command record.
 * @param id Unique identifier to search for
 * @param updates Partial properties to overwrite on the discovered command
 * @param projectDir Optional specific workspace
 */
export async function updateCommandStatus(id: string, updates: Partial<CommandRecord>, projectDir?: string): Promise<void> {
  const file = getRegistryFilePath(projectDir);
  if (!fs.existsSync(file)) return;

  try {
    const release = await lockfile.lock(file, { retries: { retries: 5, minTimeout: 50, maxTimeout: 200 } });
    try {
      let history: CommandRecord[] = [];
      try {
        history = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {}

      const index = history.findIndex((cmd) => cmd.id === id);
      if (index !== -1) {
        history[index] = { ...history[index], ...updates };
        fs.writeFileSync(file, JSON.stringify(history, null, 2));
        portalEvents.emitCommandHistoryUpdated(projectDir || os.tmpdir());
      }
    } finally {
      await release();
    }
  } catch (e: any) {
    throw new Error(`Registry contention timeout: ${e.message}`);
  }
}

/**
 * Returns a parsed Array of historic command records.
 * @param projectDir Optional specific workspace
 * @returns Array of CommandRecords currently saved in state
 */
export function getCommandHistory(projectDir?: string): CommandRecord[] {
  const file = getRegistryFilePath(projectDir);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}
