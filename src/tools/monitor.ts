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
import path from "node:path";
import crypto from "node:crypto";
import { validateSerialPort, validateBaudRate } from "../utils/validation.js";
import { PlatformIOError } from "../utils/errors.js";
import { portSemaphoreManager } from "../utils/semaphore.js";
import { getFirstDevice } from "./devices.js";
import { registerPioMonitorPid, killPioMonitorByPort } from "../utils/process-manager.js";
import { platformioExecutor } from "../platformio.js";
import { portalEvents } from "../api/events.js";
import { logDiagnostic as logDiag } from "../utils/logger.js";
import { tailFileBounded } from "../utils/tail.js";
import { getLogDir, rotateSpoolerStreams } from "../utils/spooler.js";
import { getWorkspaces, rewriteRegistry } from "../utils/workspace-registry.js";
import { getActiveMonitorPids, isPidAlive, isBuildActive } from "../utils/process-manager.js";
import { mcpContext } from "../utils/mcp-context.js";
import { redactSecretsInText } from "../core/policy/redact.js";



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
  poller?: ReturnType<typeof setInterval>; // Polling fallback for Windows fs.watch
  taskId?: string; // UUID to isolate socket routing
  projectDir?: string; // Workspace that owns the monitor log
  startedAt: string; // Monitor start or rehydration timestamp
  lastActivityAt?: string; // Last observed log write timestamp
};

// Global pool of hardware streams managed by the MCP server
const activeDaemons: Record<string, DaemonContext> = {};
const captureLeases = new Map<
  string,
  { leaseId: string; acquiredAt: string; projectDir: string }
>();

export function getSpoolerStates() {
  const clean: Record<string, Omit<DaemonContext, "watcher" | "poller">> = {};
  for (const [port, daemon] of Object.entries(activeDaemons)) {
    const { watcher, poller, ...rest } = daemon;
    clean[port] = rest;
  }
  return clean;
}

function emitNewLogBytes(port: string, daemon: DaemonContext): void {
  let fd: number | undefined;
  try {
    const stat = fs.statSync(daemon.logFile);
    if (stat.size <= (daemon.fileOffset || 0)) return;

    const start = daemon.fileOffset || 0;
    const buffer = Buffer.alloc(stat.size - start);
    fd = fs.openSync(daemon.logFile, "r");
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const text = buffer.toString();
    if (text.length > 0) {
      portalEvents.emitSerialLog(port, text, daemon.taskId);
      daemon.lastActivityAt = new Date().toISOString();
    }
    daemon.fileOffset = stat.size;
  } catch {
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function startWindowsPollingFallback(port: string, daemon: DaemonContext): void {
  if (process.platform !== "win32" || daemon.poller) return;

  daemon.poller = setInterval(() => {
    emitNewLogBytes(port, daemon);
  }, 500);
}

/**
 * Clears outdated serial traces beyond the rotation limit to prevent disk bloat.
 *
 * @param maxHistory - Maximum total bounded files to retain.
 */


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
    if (daemon.poller) {
      clearInterval(daemon.poller);
      daemon.poller = undefined;
    }
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
          portalEvents.emitSerialLog(port, buffer.toString(), daemon.taskId);
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



async function spawnPioMonitor(targetPort: string, projectDir?: string, rootCommandId?: string) {
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
    const cliDesc = `pio device monitor ${monitorArgs.join(" ")}`;
    await registerPioMonitorPid(targetPort, proc.pid, projectDir, rootCommandId, daemon.logFile, daemon.taskId, cliDesc);
  }

  // Symlink or copy to 'latest-monitor.log' for easy querying
  const targetDir = getLogDir("monitor", projectDir);
  const latestLog = path.join(targetDir, "latest-monitor.log");
  try {
    if (fs.existsSync(latestLog)) fs.unlinkSync(latestLog);
    // On Unix, a symlink is best. On Windows it might require admin, so hardlink or just copying is safer.
    // Soft link is robust across different mounted volumes
    fs.symlinkSync(daemon.logFile, latestLog);
  } catch (e) {
    try {
      fs.linkSync(daemon.logFile, latestLog);
    } catch {
      logDiag(`[Spooler] Failed to link latest-monitor.log: ${e}`, projectDir);
    }
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
    if (fs.existsSync(projectDir)) {
      activeWorkspaces.push(projectDir);

      if (isBuildActive(projectDir)) {
        // Build is active
      }

      const pids = getActiveMonitorPids(projectDir);
      for (const port in pids) {
        const pid = pids[port];
        if (isPidAlive(pid)) {
          if (!activeDaemons[port]) {
            const logFile = path.join(getLogDir("monitor", projectDir), "latest-monitor.log");
            let currentSize = 0;
            try {
              if (fs.existsSync(logFile)) {
                currentSize = fs.statSync(logFile).size;
              }
            } catch {}

            // Restore taskId from the command registry so hydration events carry the correct key.
            // The original startMonitor() stored it via registerPioMonitorPid → registerCommand.
            let restoredTaskId: string | undefined;
            try {
              const history = getCommandHistory();
              const cmd = [...history].reverse().find(c =>
                c.tasks?.some(t => t.type === "monitor" && t.status === "running" && t.port === port)
              );
              restoredTaskId = cmd?.tasks.find(
                t => t.type === "monitor" && t.status === "running" && t.port === port
              )?.taskId;
            } catch {}
            if (!restoredTaskId) {
              restoredTaskId = crypto.randomUUID();
            }

            const daemon: DaemonContext = {
              baudRate: 115200, // Placeholder
              hwid: null,
              logFile,
              fileOffset: currentSize,
              taskId: restoredTaskId,
              projectDir,
              startedAt: new Date().toISOString(),
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
                        portalEvents.emitSerialLog(port, chunk.toString(), daemon.taskId);
                      });
                      daemon.fileOffset = stat.size;
                    }
                  } catch (e) {}
                }
              });
              daemon.watcher.on("error", () => {
                // Ignore watcher errors on constrained environments.
              });
              startWindowsPollingFallback(port, daemon);
              rehydrationCount++;
              logDiag(`[Monitor Recovery] Successfully rehydrated stream for ${port} (PID: ${pid}) in ${projectDir}`);
            } catch (e: any) {
               logDiag(`[Monitor Recovery] Failed to attach fs.watch to orphaned port ${port}: ${e.message}`, projectDir);
            }
          }
        }
      }
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
  rootCommandId?: string,
) {
  const ctx = mcpContext.getStore();
  const effectiveCommandId = rootCommandId || ctx?.activityId;
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

  const targetDir = getLogDir("monitor", projectDir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const { logFile } = rotateSpoolerStreams("monitor", projectDir);

  portSemaphoreManager.claimPort(activePort, "Monitor Daemon");

  const monitorTaskId = crypto.randomUUID();

  const daemon: DaemonContext = {
    baudRate: baud,
    environment,
    hwid: activeHwid,
    logFile,
    fileOffset: 0,
    taskId: monitorTaskId,
    projectDir,
    startedAt: new Date().toISOString(),
  };
  activeDaemons[activePort] = daemon;

  await spawnPioMonitor(activePort, projectDir, effectiveCommandId);

  // Attach UI portal tailing
  try {
    daemon.watcher = fs.watch(logFile, (eventType) => {
      if (eventType === 'change') {
        try {
          const stat = fs.statSync(logFile);
          if (stat.size > (daemon.fileOffset || 0)) {
            const stream = fs.createReadStream(logFile, { start: daemon.fileOffset || 0, end: stat.size - 1 });
            stream.on('data', (chunk) => {
              portalEvents.emitSerialLog(activePort!, chunk.toString(), daemon.taskId);
            });
            daemon.fileOffset = stat.size;
          }
        } catch (e) {}
      }
    });
    daemon.watcher.on("error", () => {
      // Ignore watcher errors on constrained environments.
    });
  } catch (e) {
    logDiag(`[Spooler] Failed to attach fs.watch to ${logFile}`, projectDir);
  }

  startWindowsPollingFallback(activePort, daemon);

  portalEvents.emitSpoolerStates(getSpoolerStates());

  return {
    success: true,
    port: activePort,
    logFile,
    taskId: monitorTaskId,
    startedAt: daemon.startedAt,
  };
}

import { getCommandHistory, findCommandAcrossWorkspaces } from "../utils/command-registry.js";

/**
 * Tool for agents to scan historical offline device payloads.
 */
export async function queryLogs(
  lines: number = 100,
  searchPattern?: string,
  taskId?: string,
  logPath?: string,
  projectDir?: string,
  port?: string,
) {
  let targetPaths: string[] = [];

  if (taskId) {
    let history = getCommandHistory(projectDir);
    let cmd = history.find(c => c.id === taskId);

    // Cross-workspace fallback: if the caller omitted projectDir, the task
    // may live in a project-specific registry rather than the global one.
    if (!cmd && !projectDir) {
      const crossResult = await findCommandAcrossWorkspaces(taskId);
      if (crossResult) {
        cmd = crossResult.command;
      }
    }

    if (cmd) {
      targetPaths = cmd.tasks
        .flatMap(a => a.logPaths || [])
        .filter((f): f is string => Boolean(f && fs.existsSync(f)));
    }
  } else if (logPath) {
    if (fs.existsSync(logPath)) {
      targetPaths = [logPath];
    }
  } else if (port && activeDaemons[port]) {
    targetPaths = [activeDaemons[port].logFile];
  } else {
    const targetDir = getLogDir("monitor", projectDir);
    const targetFile = path.join(targetDir, "latest-monitor.log");
    if (fs.existsSync(targetFile)) {
      targetPaths = [targetFile];
    }
  }

  if (targetPaths.length === 0) {
    return {
      success: false,
      content: `No active or recent logs found for query context (taskId: ${taskId || "none"}, port: ${port || "none"}, logPath: ${logPath || "none"}).`,
    };
  }

  let stitchedLines: string[] = [];
  for (const p of targetPaths) {
    stitchedLines = stitchedLines.concat(await tailFileBounded(p));
  }

  if (searchPattern) {
    try {
      const regex = new RegExp(searchPattern, "i");
      stitchedLines = stitchedLines.filter((line) => regex.test(line));
    } catch (e) {
      return {
        success: false,
        content: `Invalid regex search pattern provided: ${searchPattern}`,
      };
    }
  }

  if (stitchedLines.length > lines) {
    stitchedLines = stitchedLines.slice(-lines);
  }

  return { success: true, content: redactSecretsInText(stitchedLines.join("\n")) };
}

/** Stable status details for one serial monitor. */
export interface MonitorStatusResult {
  state: "active" | "inactive" | "stale";
  port?: string;
  baudRate?: number;
  environment?: string;
  projectDir?: string;
  taskId?: string;
  leaseOwner?: string;
  logPath?: string;
  cursor?: string;
  startedAt?: string;
  lastActivityAt?: string;
}

/**
 * Creates an opaque incremental-read cursor for a monitor log.
 *
 * @param logPath - Absolute monitor log path.
 * @param offset - Next byte offset to read.
 * @returns Bounded opaque cursor string.
 */
function encodeMonitorCursor(logPath: string, offset: number): string {
  const payload = {
    version: 1,
    logHash: crypto.createHash("sha256").update(path.resolve(logPath)).digest("hex"),
    offset,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Reads and validates an opaque incremental monitor cursor.
 *
 * @param cursor - Cursor supplied by a previous read.
 * @param logPath - Current monitor log path.
 * @returns Validated byte offset.
 */
function decodeMonitorCursor(cursor: string, logPath: string): number {
  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      version?: number;
      logHash?: string;
      offset?: number;
    };
    const expectedHash = crypto
      .createHash("sha256")
      .update(path.resolve(logPath))
      .digest("hex");
    if (
      payload.version !== 1 ||
      payload.logHash !== expectedHash ||
      !Number.isSafeInteger(payload.offset) ||
      (payload.offset ?? -1) < 0
    ) {
      throw new Error("invalid cursor");
    }
    return payload.offset!;
  } catch {
    throw new PlatformIOError(
      "The serial cursor is invalid or belongs to an expired monitor log.",
      "CURSOR_EXPIRED",
    );
  }
}

/**
 * Returns active, inactive, or stale monitor state without changing hardware.
 *
 * @param port - Optional exact port selector.
 * @param projectDir - Optional project scope.
 * @returns One status record when selected, otherwise all matching records.
 */
export function getMonitorStatus(
  port?: string,
  projectDir?: string,
): MonitorStatusResult | { monitors: MonitorStatusResult[] } {
  const trackedPids = getActiveMonitorPids(projectDir);
  const statuses = Object.entries(activeDaemons)
    .filter(
      ([activePort, daemon]) =>
        (!port || activePort === port) &&
        (!projectDir || path.resolve(daemon.projectDir ?? "") === path.resolve(projectDir)),
    )
    .map(([activePort, daemon]): MonitorStatusResult => {
      let size = 0;
      let lastActivityAt = daemon.lastActivityAt;
      try {
        const stats = fs.statSync(daemon.logFile);
        size = stats.size;
        lastActivityAt = lastActivityAt ?? stats.mtime.toISOString();
      } catch {
        // A missing spool file is represented as stale below.
      }
      const trackedPid = trackedPids[activePort];
      const stale =
        !fs.existsSync(daemon.logFile) ||
        (trackedPid !== undefined && !isPidAlive(trackedPid));
      return {
        state: stale ? "stale" : "active",
        port: activePort,
        baudRate: daemon.baudRate,
        environment: daemon.environment,
        projectDir: daemon.projectDir,
        taskId: daemon.taskId,
        leaseOwner: captureLeases.get(activePort)?.leaseId,
        logPath: daemon.logFile,
        cursor: encodeMonitorCursor(daemon.logFile, size),
        startedAt: daemon.startedAt,
        lastActivityAt,
      };
    });

  if (port) {
    return statuses[0] ?? { state: "inactive", port, projectDir };
  }
  return { monitors: statuses };
}

/** Structured result from one bounded serial monitor capture. */
export interface SerialWindowResult {
  success: true;
  port: string;
  projectDir: string;
  content: string;
  bytes: number;
  cursor: string;
  cursorExpired: false;
  truncated: boolean;
  logPath: string;
  taskId?: string;
  startedMonitor: boolean;
  capturedAt: string;
}

/**
 * Reads one bounded byte range from an existing monitor log.
 *
 * @param logPath - Exact active monitor log path.
 * @param options - Cursor, explicit starting offset, and byte ceiling.
 * @returns Redacted content, cursor, and truncation metadata.
 */
export function readSerialWindowFromFile(
  logPath: string,
  options: { cursor?: string; startOffset?: number; maxBytes?: number } = {},
): {
  content: string;
  bytes: number;
  cursor: string;
  truncated: boolean;
  finalSize: number;
} {
  const finalSize = fs.statSync(logPath).size;
  const requestedStart = options.cursor
    ? decodeMonitorCursor(options.cursor, logPath)
    : Math.max(0, options.startOffset ?? 0);
  if (requestedStart > finalSize) {
    throw new PlatformIOError(
      "The serial cursor predates the current rotated monitor log.",
      "CURSOR_EXPIRED",
    );
  }
  const maxBytes = Math.min(65_536, Math.max(256, options.maxBytes ?? 16_384));
  const readStart = Math.max(requestedStart, finalSize - maxBytes);
  const bytesToRead = Math.max(0, finalSize - readStart);
  let content = "";
  if (bytesToRead > 0) {
    const descriptor = fs.openSync(logPath, "r");
    try {
      const buffer = Buffer.alloc(bytesToRead);
      fs.readSync(descriptor, buffer, 0, bytesToRead, readStart);
      content = redactSecretsInText(buffer.toString("utf8"));
    } finally {
      fs.closeSync(descriptor);
    }
  }
  return {
    content,
    bytes: Buffer.byteLength(content, "utf8"),
    cursor: encodeMonitorCursor(logPath, finalSize),
    truncated: readStart > requestedStart,
    finalSize,
  };
}

/**
 * Acquires a bounded read lease, captures incremental serial bytes, and cleans up.
 *
 * @param input - Port, duration, cursor, and output bounds.
 * @returns Redacted incremental serial evidence and a new cursor.
 */
export async function captureSerialWindow(input: {
  projectDir: string;
  port?: string;
  environment?: string;
  baudRate?: number;
  durationSeconds?: number;
  maxBytes?: number;
  cursor?: string;
}): Promise<SerialWindowResult> {
  const projectDir = path.resolve(input.projectDir);
  let selectedPort = input.port;
  let startedMonitor = false;

  if (!selectedPort) {
    const matchingPorts = Object.entries(activeDaemons)
      .filter(([, daemon]) => path.resolve(daemon.projectDir ?? "") === projectDir)
      .map(([activePort]) => activePort);
    if (matchingPorts.length > 1) {
      throw new PlatformIOError(
        "Multiple active monitors match this project; specify one exact port.",
        "AMBIGUOUS_TARGET",
      );
    }
    selectedPort = matchingPorts[0];
  }

  if (!selectedPort || !activeDaemons[selectedPort]) {
    const started = await startMonitor(
      selectedPort,
      input.baudRate,
      projectDir,
      input.environment,
    );
    selectedPort = started.port;
    startedMonitor = true;
  }

  const daemon = activeDaemons[selectedPort];
  if (!daemon) {
    throw new PlatformIOError(
      "Serial monitor did not become available for capture.",
      "MONITOR_UNAVAILABLE",
    );
  }
  if (captureLeases.has(selectedPort)) {
    throw new PlatformIOError(
      `A bounded capture is already running on ${selectedPort}.`,
      "OVERLAPPING_RUN",
    );
  }

  const leaseId = crypto.randomUUID();
  captureLeases.set(selectedPort, {
    leaseId,
    acquiredAt: new Date().toISOString(),
    projectDir,
  });
  const durationMs = Math.min(60, Math.max(0, input.durationSeconds ?? 5)) * 1000;
  const maxBytes = Math.min(65_536, Math.max(256, input.maxBytes ?? 16_384));

  try {
    let initialSize = 0;
    try {
      initialSize = fs.statSync(daemon.logFile).size;
    } catch {
      // The monitor process may create the spool file on its first write.
    }
    const startOffset = input.cursor
      ? decodeMonitorCursor(input.cursor, daemon.logFile)
      : initialSize;
    if (durationMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, durationMs));
    }

    try {
      fs.statSync(daemon.logFile);
    } catch {
      throw new PlatformIOError(
        "The serial monitor log is unavailable.",
        "MONITOR_UNAVAILABLE",
      );
    }
    const window = readSerialWindowFromFile(daemon.logFile, {
      startOffset,
      maxBytes,
    });

    return {
      success: true,
      port: selectedPort,
      projectDir,
      content: window.content,
      bytes: window.bytes,
      cursor: window.cursor,
      cursorExpired: false,
      truncated: window.truncated,
      logPath: daemon.logFile,
      taskId: daemon.taskId,
      startedMonitor,
      capturedAt: new Date().toISOString(),
    };
  } finally {
    captureLeases.delete(selectedPort);
    if (startedMonitor) {
      await stopMonitor(selectedPort, projectDir).catch(() => {});
    }
  }
}
