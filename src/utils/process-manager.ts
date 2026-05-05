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
import lockfile from "proper-lockfile";
import { logDiagnostic as logDiag } from "./logger.js";
import { registerCommand, updateTaskStatus, getCommandHistory } from "./command-registry.js";
import crypto from "node:crypto";
import { SERVER_DATA_DIR, ensureGlobalDirs } from "./paths.js";

const WORKSPACE_DIR = ".pio-mcp-workspace";
const LOCKS_DIR = "locks";
const SERIAL_PIDS_FILE = "monitor-pids.json";
const BUILD_PIDS_FILE = "active_tasks.json";

/**
 * Gets the absolute path to the PID tracking file.
 */
function getPidsFilePath(projectDir?: string, file: string = SERIAL_PIDS_FILE): string {
  if (file === SERIAL_PIDS_FILE) {
    // Serial ports are global OS-level hardware resources.
    // Tracking them globally prevents Project B from attempting to open a port held by Project A.
    ensureGlobalDirs();
    const dir = path.join(SERVER_DATA_DIR, "serial_monitors");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, file);
  } else if (file === BUILD_PIDS_FILE) {
    // Build tasks are strictly scoped to the project environment
    const baseDir = projectDir || SERVER_DATA_DIR;
    if (!projectDir) ensureGlobalDirs();
    const dir = path.join(baseDir, WORKSPACE_DIR, "tasks");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, file);
  }
  const baseDir = projectDir || SERVER_DATA_DIR;
  if (!projectDir) ensureGlobalDirs();
  return path.join(baseDir, WORKSPACE_DIR, LOCKS_DIR, file);
}

/**
 * Records a given process ID belonging to a started serial monitor.
 */
export async function registerPioMonitorPid(
  port: string, 
  pid: number, 
  projectDir?: string, 
  rootCommandId?: string, 
  logFile?: string,
  taskId?: string,
  commandDesc?: string
): Promise<void> {
  const pidsFile = getPidsFilePath(projectDir);
  const dir = path.dirname(pidsFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(pidsFile)) fs.writeFileSync(pidsFile, "{}");

  try {
    const release = await lockfile.lock(pidsFile, { retries: { retries: 5, minTimeout: 50, maxTimeout: 200 } });
    try {
      let pids: Record<string, number> = {};
      try {
        pids = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
      } catch {}
      pids[port] = pid;
      fs.writeFileSync(pidsFile, JSON.stringify(pids, null, 2));
    } finally {
      await release();
    }
  } catch (e: any) {
    throw new Error(`Registry contention timeout: ${e.message}`);
  }

  try {
    const commandId = rootCommandId || crypto.randomUUID();
    const effectiveTaskId = taskId || crypto.randomUUID();
    
    await registerCommand({
      id: commandId,
      commandDesc: `PIO Serial Monitor: ${port}`,
      timestamp: Date.now(),
      status: "running",
      tasks: [{
        taskId: effectiveTaskId,
        type: "monitor",
        status: "running",
        port: port,
        pid: pid,
        commandDesc: commandDesc,
        logPaths: logFile ? [logFile] : []
      }]
    }, projectDir);
  } catch (e: any) {
    logDiag(`[ProcessManager] Failed to register monitor command: ${e.message}`, projectDir);
  }
}

/**
 * Removes the recorded PID tracking for a specific port.
 */
export async function unregisterPioMonitorPid(port: string, projectDir?: string): Promise<void> {
  const pidsFile = getPidsFilePath(projectDir, SERIAL_PIDS_FILE);
  
  if (fs.existsSync(pidsFile)) {
    try {
      const release = await lockfile.lock(pidsFile, { retries: { retries: 5, minTimeout: 50, maxTimeout: 200 } });
      try {
        const pids: Record<string, number> = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
        if (pids[port]) {
          delete pids[port];
          fs.writeFileSync(pidsFile, JSON.stringify(pids, null, 2));
        }
      } finally {
        await release();
      }
    } catch (e: any) {
      throw new Error(`Registry contention timeout: ${e.message}`);
    }
  }

  try {
    const history = getCommandHistory(projectDir);
    // Find the command that contains an actively running monitor task for this port
    const activeCommand = [...history].reverse().find(cmd => 
      cmd.tasks?.some(a => a.type === "monitor" && a.status === "running" && a.port === port)
    );
    if (activeCommand) {
      const activeTask = activeCommand.tasks.find(a => a.type === "monitor" && a.status === "running" && a.port === port);
      if (activeTask) {
        await updateTaskStatus(activeCommand.id, activeTask.taskId, { status: "terminated" }, projectDir);
      }
    }
  } catch (e: any) {
    logDiag(`[ProcessManager] Failed to update monitor command status: ${e.message}`, projectDir);
  }
}

/**
 * Target-kills a stray or explicitly stopped monitor process via tree-kill.
 */
export function killPioMonitorByPort(port: string, projectDir?: string): Promise<void> {
  return new Promise((resolve) => {
    let targetPid: number | undefined;
    
    const pidsFile = getPidsFilePath(projectDir, SERIAL_PIDS_FILE);
    if (fs.existsSync(pidsFile)) {
      try {
        const pids: Record<string, number> = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
        targetPid = pids[port];
      } catch {}
    }

    if (!targetPid) {
      try {
        const history = getCommandHistory(projectDir);
        for (const cmd of history) {
          if (cmd.status === "running" && cmd.tasks) {
            for (const task of cmd.tasks) {
              if (task.type === "monitor" && task.status === "running" && task.port === port && task.pid) {
                targetPid = task.pid;
                break;
              }
            }
          }
          if (targetPid) break;
        }
      } catch {}
    }

    if (targetPid) {
      logDiag(`[ProcessManager Diagnostic] Found tracked PID ${targetPid} for port ${port}. Yielding to tree-kill...`, projectDir);
      treeKill(targetPid, "SIGKILL", async (err) => {
        if (err) {
          logDiag(`[ProcessManager Diagnostic] Failed to tree-kill PID ${targetPid}: ${err.message}`, projectDir);
        } else {
          logDiag(`[ProcessManager Diagnostic] Successfully tree-killed PID ${targetPid}.`, projectDir);
        }
        await unregisterPioMonitorPid(port, projectDir);
        resolve();
      });
    } else {
      // Always ensure we unregister and update command status even if the PID was missing or already died
      unregisterPioMonitorPid(port, projectDir).finally(resolve);
    }
  });
}

/**
 * OS-level check to verify if a PID is actively running PlatformIO/Python.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Throws if process is dead
    if (os.platform() !== "win32") {
      try {
        const stdout = execSync(`ps -p ${pid} -o command=`, { encoding: "utf8" }).toLowerCase();
        if (!stdout.includes("platformio") && !stdout.includes("pio") && !stdout.includes("python")) {
          return false;
        }
        try {
          const stat = execSync(`ps -p ${pid} -o stat=`, { encoding: "utf8" }).trim().toUpperCase();
          if (stat.startsWith("Z")) {
            return false;
          }
        } catch {}
      } catch {
        // ps fails -> process probably dead or inaccessible
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the raw track-list of active monitor daemon PIDs for a specific workspace.
 */
export function getActiveMonitorPids(projectDir?: string): Record<string, number> {
  const pidsFile = getPidsFilePath(projectDir, SERIAL_PIDS_FILE);
  if (!fs.existsSync(pidsFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(pidsFile, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Checks if a build is currently tracked and actively running.
 */
export function isBuildActive(projectDir?: string): boolean {
  const pidsFile = getPidsFilePath(projectDir, BUILD_PIDS_FILE);
  if (!fs.existsSync(pidsFile)) return false;
  try {
    const pids: Record<string, any> = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
    for (const key of Object.keys(pids)) {
      if (pids[key]?.type === "build" || key === "build") {
        const targetPid = key === "build" ? pids[key] : Number(key);
        if (isPidAlive(targetPid)) return true;
      }
    }
  } catch {}
  return false;
}

export async function registerBuildPid(pid: number, projectDir?: string): Promise<void> {
  const pidsFile = getPidsFilePath(projectDir, BUILD_PIDS_FILE);
  const dir = path.dirname(pidsFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(pidsFile)) fs.writeFileSync(pidsFile, "{}");

  try {
    const release = await lockfile.lock(pidsFile, { retries: { retries: 5, minTimeout: 50, maxTimeout: 200 } });
    try {
      let pids: Record<string, any> = {};
      try {
        pids = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
      } catch {}
      pids[pid.toString()] = { type: "build", started: Date.now() };
      fs.writeFileSync(pidsFile, JSON.stringify(pids, null, 2));
    } finally {
      await release();
    }
  } catch (e: any) {
    throw new Error(`Registry contention timeout: ${e.message}`);
  }
}

export async function unregisterBuildPid(projectDir?: string): Promise<void> {
  const pidsFile = getPidsFilePath(projectDir, BUILD_PIDS_FILE);
  if (!fs.existsSync(pidsFile)) return;

  try {
    const release = await lockfile.lock(pidsFile, { retries: { retries: 5, minTimeout: 50, maxTimeout: 200 } });
    try {
      const pids: Record<string, any> = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
      let changed = false;
      for (const key of Object.keys(pids)) {
        if (pids[key]?.type === "build" || key === "build") {
          delete pids[key];
          changed = true;
        }
      }
      if (changed) {
        fs.writeFileSync(pidsFile, JSON.stringify(pids, null, 2));
      }
    } finally {
      await release();
    }
  } catch (e: any) {
    throw new Error(`Registry contention timeout: ${e.message}`);
  }
}

/**
 * Wipes out all stray tracked processes across serial instances and builds.
 * Specifically used by emergency reset routines to return the system to a clean state.
 */
export async function killAllTrackedProcesses(projectDir?: string): Promise<void> {
  const tasks: Promise<void>[] = [];
  
  for (const file of [SERIAL_PIDS_FILE, BUILD_PIDS_FILE]) {
    const pidsFile = getPidsFilePath(projectDir, file);
    if (fs.existsSync(pidsFile)) {
      try {
        const pids: Record<string, any> = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
        for (const key of Object.keys(pids)) {
          let targetPid: number | undefined;
          if (file === BUILD_PIDS_FILE) {
            if (pids[key]?.type === "build" || key === "build") {
              targetPid = key === "build" ? pids[key] : Number(key);
            }
          } else {
            targetPid = pids[key];
          }
          if (targetPid) {
            logDiag(`[ProcessManager Diagnostic] Emergency killing tracked PID ${targetPid} via ${file}.`, projectDir);
            const p = new Promise<void>((res) => {
              treeKill(targetPid!, "SIGKILL", () => res());
            });
            tasks.push(p);
          }
        }
        fs.unlinkSync(pidsFile);
      } catch {}
    }
  }
  
  await Promise.all(tasks);
  
  // Ensure the command registry is immediately synchronized with reality
  await sweepGhostTasks(projectDir);
}

/**
 * Scans the command history and forcefully terminates any task that is marked as 'running'
 * but no longer has an active matching OS-level process.
 */
export async function sweepGhostTasks(projectDir?: string): Promise<void> {
  try {
    const history = getCommandHistory(projectDir);
    let changed = false;

    for (const cmd of history) {
      if (cmd.tasks) {
        for (const task of cmd.tasks) {
          if (task.status === "running") {
            const pid = task.pid;
            let isAlive = false;
            if (pid && isPidAlive(pid)) {
              isAlive = true;
            }

            if (!isAlive) {
              // Task is dead! Force transition to terminated
              await updateTaskStatus(cmd.id, task.taskId, { status: "terminated" }, projectDir);
              logDiag(`[Ghost Sweeper] Cleaned up orphaned ghost task ${task.taskId} (PID: ${pid || 'Unknown'})`, projectDir);
              changed = true;
            }
          }
        }
      }
    }
    
    if (changed) {
      logDiag(`[Ghost Sweeper] Successfully scrubbed stale background tasks from registry.`, projectDir);
    }
  } catch (e: any) {
    logDiag(`[Ghost Sweeper] Failed to sweep tasks: ${e.message}`, projectDir);
  }
}
