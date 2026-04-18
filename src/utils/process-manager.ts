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
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import treeKill from "tree-kill";
import { logDiagnostic as logDiag } from "./logger.js";

const WORKSPACE_DIR = ".pio-mcp-workspace";
const LOCKS_DIR = "locks";
const SERIAL_PIDS_FILE = "serial-pids.json";
const BUILD_PIDS_FILE = "build-pids.json";

/**
 * Gets the absolute path to the PID tracking file.
 */
function getPidsFilePath(projectDir?: string, file: string = SERIAL_PIDS_FILE): string {
  const baseDir = projectDir || os.tmpdir();
  return path.join(baseDir, WORKSPACE_DIR, LOCKS_DIR, file);
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
    const pidsFile = getPidsFilePath(projectDir, SERIAL_PIDS_FILE);
    if (!fs.existsSync(pidsFile)) {
      resolve();
      return;
    }

    try {
      const pids: Record<string, number> = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
      const targetPid = pids[port];
      if (targetPid) {
        logDiag(`[ProcessManager Diagnostic] Found tracked PID ${targetPid} for port ${port}. Yielding to tree-kill...`, projectDir);
        treeKill(targetPid, "SIGKILL", (err) => {
          if (err) {
            logDiag(`[ProcessManager Diagnostic] Failed to tree-kill PID ${targetPid}: ${err.message}`, projectDir);
          } else {
            logDiag(`[ProcessManager Diagnostic] Successfully tree-killed PID ${targetPid}.`, projectDir);
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

/**
 * Checks if a build is currently tracked and actively running.
 */
export function isBuildActive(projectDir?: string): boolean {
  const pidsFile = getPidsFilePath(projectDir, BUILD_PIDS_FILE);
  if (!fs.existsSync(pidsFile)) return false;
  try {
    const pids: Record<string, number> = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
    const pid = pids["build"];
    if (pid) {
      process.kill(pid, 0); // Throws if process is dead
      
      // OS-level validation to prevent stale PID false positives
      if (os.platform() !== "win32") {
        try {
          const stdout = execSync(`ps -p ${pid} -o command=`, { encoding: "utf8" }).toLowerCase();
          if (!stdout.includes("platformio") && !stdout.includes("pio") && !stdout.includes("python")) {
            return false;
          }
        } catch {
          // If ps fails, assume process might be dead or permission denied
          return false;
        }
      }
      
      return true;
    }
  } catch {}
  return false;
}

/**
 * Records a process ID belonging to an executed build pipeline.
 */
export function registerBuildPid(pid: number, projectDir?: string): void {
  const pidsFile = getPidsFilePath(projectDir, BUILD_PIDS_FILE);
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
  
  pids["build"] = pid;
  fs.writeFileSync(pidsFile, JSON.stringify(pids, null, 2));
}

/**
 * Removes the recorded PID tracking for a completed build stream.
 */
export function unregisterBuildPid(projectDir?: string): void {
  const pidsFile = getPidsFilePath(projectDir, BUILD_PIDS_FILE);
  if (fs.existsSync(pidsFile)) {
    try {
      const pids: Record<string, number> = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
      if (pids["build"]) {
        delete pids["build"];
        fs.writeFileSync(pidsFile, JSON.stringify(pids, null, 2));
      }
    } catch {}
  }
}

/**
 * Wipes out all stray tracked processes across serial instances and builds.
 * Specifically used by emergency reset routines to return the system to a clean state.
 */
export function killAllTrackedProcesses(projectDir?: string): Promise<void> {
  return new Promise((resolve) => {
    let tasks: Promise<void>[] = [];
    
    for (const file of [SERIAL_PIDS_FILE, BUILD_PIDS_FILE]) {
      const pidsFile = getPidsFilePath(projectDir, file);
      if (fs.existsSync(pidsFile)) {
        try {
          const pids: Record<string, number> = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
          for (const key of Object.keys(pids)) {
            const targetPid = pids[key];
            if (targetPid) {
              logDiag(`[ProcessManager Diagnostic] Emergency killing tracked PID ${targetPid} via ${file}.`, projectDir);
              const p = new Promise<void>((res) => {
                treeKill(targetPid, "SIGKILL", () => res());
              });
              tasks.push(p);
            }
          }
          fs.unlinkSync(pidsFile);
        } catch {}
      }
    }
    
    Promise.all(tasks).then(() => resolve());
  });
}
