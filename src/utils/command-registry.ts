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
export interface ArtifactRecord {
  id: string; // Internal trace ID
  type: "build" | "monitor" | "upload" | "test" | "debug";
  status: "inactive" | "running" | "success" | "error" | "terminated";
  logFile?: string;
  port?: string;
  pid?: number;
  exitCode?: number;
}

export interface CommandRecord {
  id: string; // The root invocation ID
  commandDesc: string; // E.g., 'pio run -t upload'
  timestamp: number;
  status: "running" | "success" | "error" | "terminated"; // Overall process status
  artifacts: ArtifactRecord[];
}

/**
 * Appends a new command record into the workspace command history, or appends an artifact if the command exists.
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

      const existingIndex = history.findIndex(cmd => cmd.id === record.id);
      if (existingIndex !== -1) {
        // Just merge artifacts if appending to an existing command chain
        const existingCmd = history[existingIndex];
        record.artifacts.forEach(newArt => {
          if (!existingCmd.artifacts.find(a => a.id === newArt.id)) {
            existingCmd.artifacts.push(newArt);
          }
        });
        existingCmd.status = record.status;
      } else {
        history.push(record);
        if (history.length > MAX_HISTORY_ITEMS) {
          history = history.slice(-MAX_HISTORY_ITEMS);
        }
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
 * Updates a specific nested artifact's status.
 */
export async function updateArtifactStatus(commandId: string, artifactId: string, updates: Partial<ArtifactRecord>, projectDir?: string): Promise<void> {
  const file = getRegistryFilePath(projectDir);
  if (!fs.existsSync(file)) return;

  try {
    const release = await lockfile.lock(file, { retries: { retries: 5, minTimeout: 50, maxTimeout: 200 } });
    try {
      let history: CommandRecord[] = [];
      try {
        history = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {}

      const cmdIndex = history.findIndex((cmd) => cmd.id === commandId);
      if (cmdIndex !== -1) {
        const cmd = history[cmdIndex];
        const artIndex = cmd.artifacts?.findIndex((art) => art.id === artifactId) ?? -1;
        if (artIndex !== -1) {
          cmd.artifacts[artIndex] = { ...cmd.artifacts[artIndex], ...updates };

          // Automatically roll up statuses (if all artifacts are success, parent is success)
          const allSuccess = cmd.artifacts.every(a => a.status === 'success');
          const anyError = cmd.artifacts.some(a => a.status === 'error');
          const anyRunning = cmd.artifacts.some(a => a.status === 'running');
          
          if (anyError) cmd.status = 'error';
          else if (anyRunning) cmd.status = 'running';
          else if (allSuccess) cmd.status = 'success';
          else cmd.status = 'terminated';

          fs.writeFileSync(file, JSON.stringify(history, null, 2));
          portalEvents.emitCommandHistoryUpdated(projectDir || os.tmpdir());
        }
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
