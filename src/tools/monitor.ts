/**
 * Serial Monitor Spooler Daemon
 * Background persistence for serial logs.
 *
 * Provides:
 * - startMonitor: Initiates an asynchronous serial hook directly to disk.
 * - stopMonitor: Safely kills the daemon and unlocks the port.
 * - queryLogs: Pulls historical/grep'd records from the spool buffer safely.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateSerialPort, validateBaudRate } from "../utils/validation.js";
import { PlatformIOError } from "../utils/errors.js";
import { portSemaphoreManager } from "../utils/semaphore.js";
import { getFirstDevice } from "./devices.js";
import { registerPioMonitorPid, killPioMonitorByPort } from "../utils/process-manager.js";
import { platformioExecutor } from "../platformio.js";
import { portalEvents } from "../api/events.js";
import { logDiagnostic as logDiag } from "../utils/logger.js";
import { tailFileBounded } from "../utils/tail.js";
import { getWorkspaces, rewriteRegistry } from "../utils/workspace-registry.js";
import { getActiveMonitorPids, isPidAlive, isBuildActive } from "../utils/process-manager.js";

const WORKSPACE_DIR = ".pio-mcp-workspace";
const LOGS_DIR = "serial_monitors/logs";

function getLogDir(projectDir?: string): string {
  const baseDir = projectDir || os.tmpdir();
  return path.join(baseDir, WORKSPACE_DIR, LOGS_DIR);
}

/**
 * State and context mapping for an actively spooled hardware port.
 */
type DaemonContext = {
  baudRate: number; // Communication speed override
  environment?: string; // Configured environment properties map
  hwid: string | null; // HWID to track the device across macOS descriptor re-enumerations
  logFile: string; // Active absolute path to the local primary written file
  fileOffset?: number; // Internal tailing offset
  watcher?: fs.FSWatcher; // Tailing pointer
};

// Global pool of hardware streams managed by the MCP server
const activeDaemons: Record<string, DaemonContext> = {};

export function getSpoolerStates() {
  return activeDaemons;
}

/**
 * Clears outdated serial traces beyond the rotation limit to prevent disk bloat.
 *
 * @param maxHistory - Maximum total bounded files to retain.
 */
async function rotateLogs(targetDir: string, maxHistory = 30) {
  if (!fs.existsSync(targetDir)) return;
  const fileNames = fs
    .readdirSync(targetDir)
    .filter((f) => f.startsWith("device-monitor-") && f.endsWith(".log"));

  const files = await Promise.all(
    fileNames.map(async (name) => {
      const filePath = path.join(targetDir, name);
      try {
        const stat = await fs.promises.stat(filePath);
        return {
          name,
          path: filePath,
          ctime: stat.ctime.getTime(),
        };
      } catch (e) {
        return null;
      }
    })
  );

  const validFiles = files.filter((f): f is NonNullable<typeof f> => f !== null);
  validFiles.sort((a, b) => b.ctime - a.ctime); // Newest first

  if (validFiles.length > maxHistory) {
    const toDelete = validFiles.slice(maxHistory);
    for (const f of toDelete) {
      try {
        await fs.promises.unlink(f.path);
      } catch (e) {}
    }
  }
}

/**
 * Safely stops an active monitor daemon session and unlocks its port.
 *
 * @param port - The serial COM port to terminate polling on.
 * @param projectDir - Optional project directory context.
 */
export async function stopMonitor(port: string, projectDir?: string) {
  logDiag(`[Spooler Diagnostic] stopMonitor called for port ${port}.`, projectDir);
  
  if (activeDaemons[port]) {
    logDiag(`[Spooler Diagnostic] Deleting activeDaemons context.`, projectDir);
    const daemon = activeDaemons[port];
    if (daemon.watcher) {
      // ARCHITECTURAL EXCEPTION: While synchronous fs calls are broadly banned to prevent 
      // event loop blocking, fs.statSync and fs.readSync are mathematically required here 
      // at the exact nanosecond of process termination. Using asynchronous promises yields 
      // to the event loop, causing the FSEvents watcher to close before the OS can flush 
      // the final chunk event, permanently dropping the trailing output lines from the UI.
      try {
        const stat = fs.statSync(daemon.logFile);
        if (stat.size > (daemon.fileOffset || 0)) {
          const buffer = Buffer.alloc(stat.size - (daemon.fileOffset || 0));
          const fd = fs.openSync(daemon.logFile, "r");
          fs.readSync(fd, buffer, 0, buffer.length, (daemon.fileOffset || 0));
          fs.closeSync(fd);
          portalEvents.emitSerialLog(port, buffer.toString());
        }
      } catch {}
      try { daemon.watcher.close(); } catch {}
    }
    delete activeDaemons[port];
    portalEvents.emitSpoolerStates(getSpoolerStates());
    try {
      portSemaphoreManager.releasePort(port);
    } catch (e) {}
  }

  logDiag(`[Spooler Diagnostic] Triggering killPioMonitorByPort on ${port}...`, projectDir);
  await killPioMonitorByPort(port, projectDir);
  logDiag(`[Spooler Diagnostic] killPioMonitorByPort completed.`, projectDir);
}

/**
 * Utility to generate a fresh log file path for a port.
 */
async function rotateSpoolerStreams(projectDir?: string) {
  const targetDir = getLogDir(projectDir);

  await rotateLogs(targetDir, 30);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = path.join(targetDir, `device-monitor-${timestamp}.log`);
  const latestLog = path.join(targetDir, "latest-monitor.log");

  return { logFile, latestLog };
}

async function spawnPioMonitor(targetPort: string, projectDir?: string) {
  const daemon = activeDaemons[targetPort];
  if (!daemon) return;

  const monitorArgs = [
    "--port", targetPort,
    "--quiet",
    "--raw"
  ];

  if (daemon.environment) {
    monitorArgs.push("--environment", daemon.environment);
  } else {
    monitorArgs.push("--baud", daemon.baudRate.toString());
  }

  logDiag(`[Spooler] Spawning pio monitor (Env: ${daemon.environment || "None"}) via executor for ${targetPort}`, projectDir);

  // Instead of node managing the streams via stdout.on, we pass the file descriptor directly to the OS.
  const outFd = fs.openSync(daemon.logFile, 'a');
  const proc = await platformioExecutor.spawn("device", ["monitor", ...monitorArgs], {
    detached: true,
    useFakeTty: true,
    stdio: ['ignore', outFd, outFd]
  });

  if (proc.pid) {
    // Record PID to workspace tracker
    await registerPioMonitorPid(targetPort, proc.pid, projectDir);
  }

  // Symlink or copy to 'latest-monitor.log' for easy querying
  const targetDir = getLogDir(projectDir);
  const latestLog = path.join(targetDir, "latest-monitor.log");
  try {
    if (fs.existsSync(latestLog)) fs.unlinkSync(latestLog);
    // On Unix, a symlink is best. On Windows it might require admin, so hardlink or just copying is safer.
    // Soft link is robust across different mounted volumes
    fs.symlinkSync(daemon.logFile, latestLog);
  } catch (e) {
    logDiag(`[Spooler] Failed to link latest-monitor.log: ${e}`, projectDir);
  }

  // Unref ensures the MCP server process can exit independently without waiting for the monitor daemon
  proc.unref();

  logDiag(`[Spooler] Monitor started detached with PID ${proc.pid}`, projectDir);
}

/**
 * Binds to a specified UART interface and autonomously pushes data into the
 * persistence pipeline locally to the project workspace.
 */
/**
 * Re-attaches UI streaming for any active monitors orphaned by a server crash.
 */
export async function rehydrateMonitors(): Promise<void> {
  const workspaces = await getWorkspaces();
  let rehydrationCount = 0;
  const activeWorkspaces: string[] = [];

  for (const projectDir of workspaces) {
    let workspaceIsActive = false;

    if (fs.existsSync(projectDir)) {
      if (isBuildActive(projectDir)) {
        workspaceIsActive = true;
      }

      const pids = getActiveMonitorPids(projectDir);
      for (const port in pids) {
        const pid = pids[port];
        if (isPidAlive(pid)) {
          workspaceIsActive = true;
          if (!activeDaemons[port]) {
            const logFile = path.join(getLogDir(projectDir), "latest-monitor.log");
            let currentSize = 0;
            try {
              if (fs.existsSync(logFile)) {
                currentSize = fs.statSync(logFile).size;
              }
            } catch {}

            const daemon: DaemonContext = {
              baudRate: 115200, // Placeholder
              hwid: null,
              logFile,
              fileOffset: currentSize,
            };
            activeDaemons[port] = daemon;

            try {
               daemon.watcher = fs.watch(logFile, (eventType) => {
                if (eventType === 'change') {
                  try {
                    const stat = fs.statSync(logFile);
                    if (stat.size > (daemon.fileOffset || 0)) {
                      const stream = fs.createReadStream(logFile, { start: daemon.fileOffset || 0, end: stat.size - 1 });
                      stream.on('data', (chunk) => {
                        portalEvents.emitSerialLog(port, chunk.toString());
                      });
                      daemon.fileOffset = stat.size;
                    }
                  } catch (e) {}
                }
              });
              rehydrationCount++;
              logDiag(`[Monitor Recovery] Successfully rehydrated stream for ${port} (PID: ${pid}) in ${projectDir}`);
            } catch (e: any) {
               logDiag(`[Monitor Recovery] Failed to attach fs.watch to orphaned port ${port}: ${e.message}`, projectDir);
            }
          }
        }
      }
    }

    if (workspaceIsActive) {
      activeWorkspaces.push(projectDir);
    }
  }

  // Atomically recreate the workspaces log to drop zombie entries
  await rewriteRegistry(activeWorkspaces);

  if (rehydrationCount > 0) {
    portalEvents.emitSpoolerStates(activeDaemons);
  }
}

export async function startMonitor(
  port?: string,
  baud: number = 115200,
  projectDir?: string,
  environment?: string,
) {
  let activePort = port;
  let activeHwid: string | null = null;
  
  if (!activePort) {
    const defaultDevice = await getFirstDevice();
    if (!defaultDevice)
      throw new PlatformIOError(
        "No serial devices detected to monitor.",
        "PORT_NOT_FOUND",
      );
    activePort = defaultDevice.port;
    activeHwid = defaultDevice.hwid;
  } else {
    const { findDeviceByPort } = await import("./devices.js");
    const matchedDevice = await findDeviceByPort(activePort);
    activeHwid = matchedDevice?.hwid || null;
  }

  if (!validateSerialPort(activePort))
    throw new PlatformIOError(
      `Invalid serial port format: ${activePort}`,
      "INVALID_PORT",
    );
  if (baud && !validateBaudRate(baud))
    throw new PlatformIOError(`Invalid baud rate: ${baud}`, "INVALID_BAUD");

  // Relinquish previous bindings safely if re-invoked
  await stopMonitor(activePort, projectDir);

  if (portSemaphoreManager.isPortClaimed(activePort))
    throw new PlatformIOError(
      `Port is currently locked: ${activePort}`,
      "PORT_BUSY",
    );

  const targetDir = getLogDir(projectDir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const { logFile } = await rotateSpoolerStreams(projectDir);

  portSemaphoreManager.claimPort(activePort, "Monitor Daemon");

  const daemon: DaemonContext = {
    baudRate: baud,
    environment,
    hwid: activeHwid,
    logFile,
    fileOffset: 0,
  };
  activeDaemons[activePort] = daemon;

  await spawnPioMonitor(activePort, projectDir);

  // Attach UI portal tailing
  try {
    daemon.watcher = fs.watch(logFile, (eventType) => {
      if (eventType === 'change') {
        try {
          const stat = fs.statSync(logFile);
          if (stat.size > (daemon.fileOffset || 0)) {
            const stream = fs.createReadStream(logFile, { start: daemon.fileOffset || 0, end: stat.size - 1 });
            stream.on('data', (chunk) => {
              portalEvents.emitSerialLog(activePort!, chunk.toString());
            });
            daemon.fileOffset = stat.size;
          }
        } catch (e) {}
      }
    });
  } catch (e) {
    logDiag(`[Spooler] Failed to attach fs.watch to ${logFile}`, projectDir);
  }

  portalEvents.emitSpoolerStates(getSpoolerStates());

  return { success: true, port: activePort, logFile };
}

/**
 * Tool for agents to scan historical offline device payloads.
 */
export async function queryLogs(
  lines: number = 100,
  searchPattern?: string,
  projectDir?: string,
  port?: string,
) {
  const targetDir = getLogDir(projectDir);
  let targetFile = path.join(targetDir, "latest-monitor.log");
  
  // If a specific port is requested, try to find the active log file for it
  if (port && activeDaemons[port]) {
    targetFile = activeDaemons[port].logFile;
  }

  if (!fs.existsSync(targetFile)) {
    return {
      success: false,
      content: `No active or recent logs found for ${port || "general session"} in ${targetDir}.`,
    };
  }

  let outputLines = await tailFileBounded(targetFile);

  if (searchPattern) {
    try {
      const regex = new RegExp(searchPattern, "i");
      outputLines = outputLines.filter((line) => regex.test(line));
    } catch (e) {
      return {
        success: false,
        content: `Invalid regex search pattern provided: ${searchPattern}`,
      };
    }
  }

  if (outputLines.length > lines) {
    outputLines = outputLines.slice(-lines);
  }

  return { success: true, content: outputLines.join("\n") };
}
