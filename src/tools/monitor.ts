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

const WORKSPACE_DIR = ".pio-mcp-workspace";
const LOGS_DIR = "serial_logs";

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
function rotateLogs(targetDir: string, maxHistory = 30) {
  if (!fs.existsSync(targetDir)) return;
  const files = fs
    .readdirSync(targetDir)
    .filter((f) => f.startsWith("device-monitor-") && f.endsWith(".log"))
    .map((f) => ({
      name: f,
      path: path.join(targetDir, f),
      ctime: fs.statSync(path.join(targetDir, f)).ctime.getTime(),
    }))
    .sort((a, b) => b.ctime - a.ctime); // Newest first

  if (files.length > maxHistory) {
    const toDelete = files.slice(maxHistory);
    for (const f of toDelete) {
      try {
        fs.unlinkSync(f.path);
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
function rotateSpoolerStreams(projectDir?: string) {
  const targetDir = getLogDir(projectDir);

  rotateLogs(targetDir, 30);

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

  const { logFile } = rotateSpoolerStreams(projectDir);

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
            const stream = fs.createReadStream(logFile, { start: daemon.fileOffset });
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
