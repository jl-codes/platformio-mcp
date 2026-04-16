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
