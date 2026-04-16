/**
 * OS Process Management Utilities
 * Tools for identifying and terminating conflicting serial port owners.
 *
 * Provides:
 * - registerPioMonitorPid: Records a PID to the workspace for crash resumption.
 * - unregisterPioMonitorPid: Removes a PID from the file tracker.
 * - killPioMonitorByPort: Safely terminates a tracked PID using tree-kill.
 */

import fs from "node:fs";
import path from "node:path";
import treeKill from "tree-kill";

const WORKSPACE_DIR = ".pio-mcp-workspace";
const LOCKS_DIR = "locks";
const PIDS_FILE = "serial-pids.json";

/**
 * Gets the absolute path to the PID tracking file.
 */
function getPidsFilePath(projectDir?: string): string {
  const baseDir = projectDir || process.cwd();
  return path.join(baseDir, WORKSPACE_DIR, LOCKS_DIR, PIDS_FILE);
}

/**
 * Records a given process ID belonging to a started serial monitor.
 */
export function registerPioMonitorPid(port: string, pid: number, projectDir?: string): void {
  const pidsFile = getPidsFilePath(projectDir);
  const dir = path.dirname(pidsFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let pids: Record<string, number> = {};
  if (fs.existsSync(pidsFile)) {
    try {
      pids = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
    } catch {}
  }
  
  pids[port] = pid;
  fs.writeFileSync(pidsFile, JSON.stringify(pids, null, 2));
}

/**
 * Removes the recorded PID tracking for a specific port.
 */
export function unregisterPioMonitorPid(port: string, projectDir?: string): void {
  const pidsFile = getPidsFilePath(projectDir);
  if (fs.existsSync(pidsFile)) {
    try {
      const pids: Record<string, number> = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
      if (pids[port]) {
        delete pids[port];
        fs.writeFileSync(pidsFile, JSON.stringify(pids, null, 2));
      }
    } catch {}
  }
}

/**
 * Target-kills a stray or explicitly stopped monitor process via tree-kill.
 */
export function killPioMonitorByPort(port: string, projectDir?: string): Promise<void> {
  return new Promise((resolve) => {
    const pidsFile = getPidsFilePath(projectDir);
    if (!fs.existsSync(pidsFile)) {
      resolve();
      return;
    }

    try {
      const pids: Record<string, number> = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
      const targetPid = pids[port];
      if (targetPid) {
        console.error(`[ProcessManager Diagnostic] Found tracked PID ${targetPid} for port ${port}. Yielding to tree-kill...`);
        treeKill(targetPid, "SIGKILL", (err) => {
          if (err) {
            console.error(`[ProcessManager Diagnostic] Failed to tree-kill PID ${targetPid}: ${err.message}`);
          } else {
            console.error(`[ProcessManager Diagnostic] Successfully tree-killed PID ${targetPid}.`);
          }
          unregisterPioMonitorPid(port, projectDir);
          resolve();
        });
      } else {
        resolve();
      }
    } catch {
      resolve();
    }
  });
}
