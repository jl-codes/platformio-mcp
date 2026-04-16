/**
 * Execution Spooling Utilities
 * Crash-resilient process spawning that writes directly to disk.
 *
 * Provides:
 * - rotateLogs: Generic log file rotater by prefix.
 * - rotateBuildStreams: Specialized build log rotation.
 * - executeWithSpooling: Spawns child processes mapped to disk limits.
 */
import fs from "node:fs";
import path from "node:path";
import { platformioExecutor } from "../platformio.js";
import { registerBuildPid, unregisterBuildPid, isBuildActive } from "./process-manager.js";

const WORKSPACE_DIR = ".pio-mcp-workspace";
const LOGS_DIR = "build_logs";

function getLogDir(projectDir?: string): string {
  const baseDir = projectDir || process.cwd();
  return path.join(baseDir, WORKSPACE_DIR, LOGS_DIR);
}

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

/**
 * Automatically prunes historical build payload output files from the local environment block.
 *
 * @param projectDir - Associated workspace to scope clearance into.
 * @returns Absolute routing map to latest runtime traces.
 */
export function rotateBuildStreams(projectDir?: string) {
  const targetDir = getLogDir(projectDir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  rotateLogs(targetDir, "build-", 30);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = path.join(targetDir, `build-${timestamp}.log`);
  const latestLog = path.join(targetDir, "latest-build.log");

  return { logFile, latestLog };
}

/**
 * Wraps child process invocation forcing its runtime payload exclusively through 
 * an active offline disk file context instead of active NodeJS stream memory.
 *
 * @param command - Core executing binary token.
 * @param args - CLI arguments string array.
 * @param options - Operational environment context overriding execution behavior.
 * @returns Complete exit code metadata, trace locations, and completion summaries.
 */
export async function executeWithSpooling(
  command: string,
  args: string[],
  options: { cwd: string; projectDir?: string; timeout?: number; background?: boolean }
): Promise<any> {
  const projectArea = options.projectDir ?? options.cwd;

  // 1. Crash resilience tracking
  if (isBuildActive(projectArea)) {
    throw new Error("A build is already actively running for this project.");
  }

  // 2. Setup spooling streams
  const { logFile, latestLog } = rotateBuildStreams(projectArea);
  const outFd = fs.openSync(logFile, "a");

  // 3. Spawning
  const proc = platformioExecutor.spawn(command, args, {
    cwd: options.cwd,
    stdio: ["ignore", outFd, outFd],
    detached: false
  });

  if (proc.pid) {
    registerBuildPid(proc.pid, projectArea);
  }

  try {
    if (fs.existsSync(latestLog)) fs.unlinkSync(latestLog);
    // Standard link is secure and visible to OS natively
    fs.linkSync(logFile, latestLog);
  } catch {}

  // 4. Wait for termination
  const timeoutMs = options.timeout ?? 600000;

  if (options.background) {
    const p = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (proc.pid) {
          try { process.kill(proc.pid, 'SIGKILL'); } catch {}
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
    
    p.catch(e => console.error(`[Background Task Error]: ${e.message}`)).finally(() => {
      unregisterBuildPid(projectArea);
      try { fs.closeSync(outFd); } catch {}
    });

    return { status: "running", message: "Task dispatched to background.", pid: proc.pid };
  }
  
  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (proc.pid) {
        try { process.kill(proc.pid, 'SIGKILL'); } catch {}
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

  // Cleanup
  unregisterBuildPid(projectArea);
  try {
    fs.closeSync(outFd);
  } catch {}

  // 5. Yield contextual snapshot (preventing window bloat)
  let finalOutput = "";
  try {
    const content = fs.readFileSync(logFile, "utf-8");
    const lines = content.split("\n");
    finalOutput = lines.slice(-150).join("\n");
  } catch (e: any) {
    finalOutput = `[Spooler Fetch Error] Could not parse log ending: ${e.message}`;
  }

  return { exitCode, finalOutput, fullLogPath: logFile };
}
