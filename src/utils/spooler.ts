/**
 * Execution Spooling Utilities
 * Crash-resilient process spawning that writes directly to disk.
 *
 * Provides:
 * - rotateLogs: Generic log file rotater by prefix.
 * - rotateSpoolerStreams: Specialized spool log rotation.
 * - executeWithSpooling: Spawns child processes mapped to disk limits.
 */
import fs from "node:fs";

import path from "node:path";
import { platformioExecutor } from "../platformio.js";
import { registerBuildPid, unregisterBuildPid, isBuildActive } from "./process-manager.js";
import { portSemaphoreManager } from "./semaphore.js";
import { tailFileBounded } from "./tail.js";
import { registerCommand, updateTaskStatus } from "./command-registry.js";
import crypto from "node:crypto";
import { mcpContext } from "./mcp-context.js";
import { parseStderrErrors } from "./errors.js";

import { SERVER_DATA_DIR, ensureGlobalDirs } from "./paths.js";

import { SERVER_DATA_DIR, ensureGlobalDirs } from "./paths.js";

const WORKSPACE_DIR = ".pio-mcp-workspace";
export function getLogDir(verb: string, projectDir?: string): string {
  const baseDir = projectDir || SERVER_DATA_DIR;
  if (!projectDir) ensureGlobalDirs();
  return path.join(baseDir, WORKSPACE_DIR, "logs", verb);
}
import { logDiagnostic as logDiag } from "./logger.js";
import { portalEvents } from "../api/events.js";
/**
 * Cleans out old log trace files adhering to an upper boundary limit.
 *
 * @param targetDir - Evaluated workspace folder storing logs.
 * @param prefix - Filter signature indicating matching files.
 * @param maxHistory - Absolute count of youngest logs to preserve.
 */
export function rotateLogs(targetDir: string, prefix: string, maxHistory = 30) {
  if (!fs.existsSync(targetDir)) return;
  const files = fs
    .readdirSync(targetDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".log"))
    .map((f) => ({
      name: f,
      path: path.join(targetDir, f),
      ctime: fs.statSync(path.join(targetDir, f)).ctime.getTime(),
    }))
    .sort((a, b) => b.ctime - a.ctime);

  if (files.length > maxHistory) {
    const toDelete = files.slice(maxHistory);
    for (const f of toDelete) {
      try {
        fs.unlinkSync(f.path);
      } catch {}
    }
  }
}

export interface BuildStreamRotation {
  logFile: string; // The absolute path to the newly rotated log file
  latestLog: string; // The absolute path to the symlink pointing to the newest log
}

/**
 * Automatically prunes historical build payload output files from the local environment block.
 *
 * @param projectDir - Associated workspace to scope clearance into.
 * @returns The structured paths indicating where the new logs are actively spooling.
 */
export function rotateSpoolerStreams(verb: string, projectDir?: string): BuildStreamRotation {
  const targetDir = getLogDir(verb, projectDir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  rotateLogs(targetDir, `${verb}-`, 30);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const shortHash = crypto.randomBytes(4).toString("hex");
  const logFile = path.join(targetDir, `${verb}-${timestamp}-${shortHash}.log`);
  const latestLog = path.join(targetDir, `latest-${verb}.log`);

  return { logFile, latestLog };
}

export interface SpoolingBackgroundResult {
  status: string; // The operational status indicating background dispatch
  message: string; // A descriptive message about the background task
  pid?: number; // The process ID of the detached background process
  taskId?: string; // Generated command ID
  logPaths?: string[]; // Arrays of logs mapping
}

export interface SpoolingForegroundResult {
  exitCode: number; // The exit code returned by the synchronous process
  finalOutput: string; // The sliced output tail retrieved from the log spool
  fullLogPath: string; // The absolute path referencing the complete log file
}

export type SpoolingResult = SpoolingBackgroundResult | SpoolingForegroundResult;

/**
 * Wraps child process invocation forcing its runtime payload exclusively through 
 * an active offline disk file context instead of active NodeJS stream memory.
 *
 * @param command - Core executing binary token.
 * @param args - CLI arguments string array.
 * @param options - Operational environment context overriding execution behavior.
 * @returns A structured result containing either background runtime metadata or foreground process completion details.
 */
export async function executeWithSpooling(
  command: string,
  args: string[],
  options: { cwd: string; projectDir?: string; timeout?: number; background?: boolean; activePort?: string; onSuccess?: () => Promise<void>; rootCommandId?: string; artifactType?: "build" | "upload" | "monitor" | "test" | "debug" }
): Promise<SpoolingResult> {
  const projectArea = options.projectDir ?? options.cwd;

  // 1. Crash resilience tracking
  if (isBuildActive(projectArea)) {
    throw new Error("A build is already actively running for this project.");
  }

  // 2. Setup spooling streams
  const verb = options.artifactType || "build";
  const { logFile, latestLog } = rotateSpoolerStreams(verb, projectArea);
  const outFd = fs.openSync(logFile, "a");

  // 3. Spawning
  const proc = await platformioExecutor.spawn(command, args, {
    cwd: options.cwd,
    stdio: ["ignore", outFd, outFd],
    detached: false
  });

  const ctx = mcpContext.getStore();
  const commandId = options.rootCommandId || ctx?.activityId || crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const artType = options.artifactType || "build";
  const targetProjectArea = projectArea || ctx?.targetProjectDir;

  if (proc.pid) {
    logDiag(`[Spooler] Spawning task command: \`${command} ${args.join(" ")}\` with Build ID/PID: ${proc.pid}`, targetProjectArea);
    await registerBuildPid(proc.pid, targetProjectArea);
    await registerCommand({
      id: commandId,
      commandDesc: `PIO Task: ${command} ${args.join(" ")}`,
      timestamp: Date.now(),
      status: "running",
      tasks: [{
        taskId: taskId,
        type: artType,
        status: "running",
        logPaths: [logFile],
        pid: proc.pid,
        commandDesc: `pio ${command} ${args.join(" ")}`
      }]
    }, targetProjectArea).catch(e => logDiag(`[Spooler] Registry fail: ${e.message}`, targetProjectArea));
  }

  try {
    if (fs.existsSync(latestLog)) fs.unlinkSync(latestLog);
    // Standard link is secure and visible to OS natively
    fs.symlinkSync(logFile, latestLog);
  } catch {}

  // UI Portal File Tailing
  let fileOffset = 0;
  let watcher: fs.FSWatcher | null = null;
  portalEvents.clearTaskLog(targetProjectArea || "global", taskId, [logFile]);

  try {
    watcher = fs.watch(logFile, (eventType) => {
      if (eventType === 'change') {
        try {
          const stat = fs.statSync(logFile);
          if (stat.size > fileOffset) {
            const stream = fs.createReadStream(logFile, { start: fileOffset, end: stat.size - 1 });
            stream.on('data', (chunk) => {
              portalEvents.emitTaskLog(targetProjectArea || "global", taskId, chunk.toString());
            });
            fileOffset = stat.size;
          }
        } catch {}
      }
    });
  } catch {}

  // 4. Wait for termination
  const timeoutMs = options.timeout ?? 600000;

  if (options.background) {
    const p = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (proc.pid) {
          try { 
            process.kill(proc.pid, 'SIGTERM'); 
            setTimeout(() => {
              try {
                if (proc.pid) {
                  process.kill(proc.pid, 0);
                  process.kill(proc.pid, 'SIGKILL');
                }
              } catch {}
            }, 1000);
          } catch {}
        }
        reject(new Error(`Command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve(code ?? 1);
      });
    });

    p.catch(e => {
      console.error(`[Background Task Error]: ${e.message}`);
      updateTaskStatus(commandId, taskId, { status: "error", error: e.message }, targetProjectArea).catch(() => {});
      return 1;
    }).then(async (code) => {
      let errorMessage = undefined;
      if (code !== 0) {
        try {
          const lines = await tailFileBounded(logFile, 512 * 1024);
          const errors = parseStderrErrors(lines.join("\n"));
          if (errors && errors.length > 0) errorMessage = errors[0];
        } catch {}
      }
      
      await updateTaskStatus(commandId, taskId, { 
        status: code === 0 ? "success" : "error",
        exitCode: code,
        ...(errorMessage ? { error: errorMessage } : {})
      }, targetProjectArea).catch(() => {});
      await unregisterBuildPid(targetProjectArea);
      if (options.activePort) portSemaphoreManager.releasePort(options.activePort);
      try { fs.closeSync(outFd); } catch {}
      if (watcher) {
        // ARCHITECTURAL EXCEPTION: While synchronous fs calls are broadly banned to prevent 
        // event loop blocking, fs.statSync and fs.readSync are mathematically required here 
        // at the exact nanosecond of process termination. Using asynchronous promises yields 
        // to the event loop, causing the FSEvents watcher to close before the OS can flush 
        // the final chunk event, permanently dropping the trailing output lines from the UI.
        try {
          const stat = fs.statSync(logFile);
          if (stat.size > fileOffset) {
            const buffer = Buffer.alloc(stat.size - fileOffset);
            const fd = fs.openSync(logFile, "r");
            fs.readSync(fd, buffer, 0, buffer.length, fileOffset);
            fs.closeSync(fd);
            portalEvents.emitTaskLog(projectArea, taskId, buffer.toString());
            fileOffset = stat.size;
          }
        } catch {}
        try { watcher.close(); } catch {}
      }

      if (code === 0 && options.onSuccess) {
        try {
          await options.onSuccess();
        } catch (e: any) {
          console.error(`[Spooler Diagnostic] Background onSuccess hook failed: ${e.message}`);
        }
      }
    });

    return { status: "running", message: "Task dispatched to background.", pid: proc.pid, taskId: commandId, logPaths: [logFile] };
  }
  
  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (proc.pid) {
        try { 
          process.kill(proc.pid, 'SIGTERM'); 
          setTimeout(() => {
            try {
              if (proc.pid) {
                process.kill(proc.pid, 0);
                process.kill(proc.pid, 'SIGKILL');
              }
            } catch {}
          }, 1000);
        } catch {}
      }
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });

  let errorMessage = undefined;
  if (exitCode !== 0) {
    try {
      const lines = await tailFileBounded(logFile, 512 * 1024);
      const errors = parseStderrErrors(lines.join("\n"));
      if (errors && errors.length > 0) errorMessage = errors[0];
    } catch {}
  }

  await updateTaskStatus(commandId, taskId, { 
    status: exitCode === 0 ? "success" : "error",
    exitCode,
    ...(errorMessage ? { error: errorMessage } : {})
  }, projectArea).catch(() => {});

  // Cleanup
  await unregisterBuildPid(projectArea);
  if (options.activePort) portSemaphoreManager.releasePort(options.activePort);
  try {
    fs.closeSync(outFd);
  } catch {}
  if (watcher) {
    // ARCHITECTURAL EXCEPTION: While synchronous fs calls are broadly banned to prevent 
    // event loop blocking, fs.statSync and fs.readSync are mathematically required here 
    // at the exact nanosecond of process termination. Using asynchronous promises yields 
    // to the event loop, causing the FSEvents watcher to close before the OS can flush 
    // the final chunk event, permanently dropping the trailing output lines from the UI.
    try {
      const stat = fs.statSync(logFile);
      if (stat.size > fileOffset) {
        const buffer = Buffer.alloc(stat.size - fileOffset);
        const fd = fs.openSync(logFile, "r");
        fs.readSync(fd, buffer, 0, buffer.length, fileOffset);
        fs.closeSync(fd);
        portalEvents.emitTaskLog(projectArea, taskId, buffer.toString());
        fileOffset = stat.size;
      }
    } catch {}
    try { watcher.close(); } catch {}
  }

  if (exitCode === 0 && options.onSuccess) {
    try {
      await options.onSuccess();
    } catch (e: any) {
      console.error(`[Spooler Diagnostic] onSuccess hook failed: ${e.message}`);
    }
  }

  // 5. Yield contextual snapshot (preventing window bloat)
  let finalOutput = "";
  try {
    const lines = await tailFileBounded(logFile, 512 * 1024);
    finalOutput = lines.slice(-150).join("\n");
  } catch (e: any) {
    finalOutput = `[Spooler Fetch Error] Could not parse log ending: ${e.message}`;
  }

  return { exitCode, finalOutput, fullLogPath: logFile };
}

/**
 * Spools a large JSON dataset to disk if it exceeds a specified string length.
 * Prevents MCP context window blowouts.
 * 
 * @param toolName - The name of the tool generating the data (used for the cache file name).
 * @param data - The raw JSON object/array payload.
 * @param targetDir - The target workspace directory to save the cache file.
 * @param threshold - The character count threshold above which the data should be spooled (default: 2000).
 * @returns Either the original data or a string message pointing to the file path.
 */
export function spoolLargeDataset(toolName: string, data: any, targetDir?: string, threshold = 2000): string | any {
  const stringified = JSON.stringify(data, null, 2);
  
  if (stringified.length > threshold) {
    // Determine the cache directory using standard getLogDir with toolName as verb
    const cacheDir = getLogDir(toolName, targetDir);
    
    // Ensure the directory exists
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    // Rotate logs to prevent infinite spools accumulating
    rotateLogs(cacheDir, `${toolName}-`, 30);
    
    // Define the cache file path
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shortHash = crypto.randomBytes(4).toString("hex");
    const cacheFile = path.join(cacheDir, `${toolName}-${timestamp}-${shortHash}.json`);
    const latestFile = path.join(cacheDir, `latest-${toolName}.json`);
    
    // Write the raw JSON data to disk
    fs.writeFileSync(cacheFile, stringified, "utf-8");
    
    // Update the latest symlink
    try {
      if (fs.existsSync(latestFile)) fs.unlinkSync(latestFile);
      fs.symlinkSync(cacheFile, latestFile);
    } catch {}
    
    return `Payload too large for context window. Full dataset successfully spooled to disk at ${cacheFile}. Please use your grep_search or view_file tools to query this file.`;
  }
  
  return data;
}
