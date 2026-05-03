/**
 * PlatformIO CLI Executor
 * Wraps the PlatformIO CLI commands and provides robust typed execution.
 *
 * Provides:
 * - execPioCommand: Executes a raw PlatformIO CLI command.
 * - parsePioJsonOutput: Parses and validates command output via Zod.
 * - checkPlatformIOInstalled: Checks if PIO is locally available.
 * - getPlatformIOVersion: Retrieves PIO version.
 * - PlatformIOExecutor: Class encapsulating PIO CLI operations.
 * - platformioExecutor: Global instance of PlatformIOExecutor.
 * - DEFAULT_TIMEOUT: Standard timeout configuration for PIO commands.
 */

import { execFile, spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import type { CommandResult } from "./types.js";
import {
  PlatformIONotInstalledError,
  PlatformIOError,
  CommandTimeoutError,
  isPlatformIONotFoundError,
} from "./utils/errors.js";

// Default timeout for commands (5 minutes for builds)
const DEFAULT_TIMEOUT = 300000; // 5 minutes

/**
 * Executes a PlatformIO CLI command.
 *
 * @param args - CLI arguments to pass to the PlatformIO binary.
 * @param options - Execution configuration options (timeout, cwd, onOutput callback).
 * @returns Result containing standard outputs and exit code.
 */
export async function execPioCommand(
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
    parseJson?: boolean;
    onOutput?: (chunk: string) => void;
  } = {},
): Promise<CommandResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  const runWrappedProcess = (
    binary: string,
  ): Promise<{ stdout: string; stderr: string; code: number }> => {
    return new Promise((resolve, reject) => {
      const child = execFile(
        binary,
        args,
        {
          cwd: options.cwd,
          timeout,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            (error as any).stdout = stdout;
            (error as any).stderr = stderr;
            reject(error);
          } else {
            resolve({
              stdout: stdout.toString(),
              stderr: stderr.toString(),
              code: 0,
            });
          }
        },
      );

      if (options.onOutput) {
        child.stdout?.on("data", (data) => options.onOutput!(data.toString()));
        child.stderr?.on("data", (data) => options.onOutput!(data.toString()));
      }
    });
  };

  try {
    // Try 'pio' first, then fall back to 'platformio'
    let result;
    try {
      result = await runWrappedProcess("pio");
    } catch (firstError) {
      // If 'pio' not found, try 'platformio'
      if (isPlatformIONotFoundError(firstError)) {
        try {
          result = await runWrappedProcess("platformio");
        } catch (secondError) {
          if (isPlatformIONotFoundError(secondError)) {
            throw new PlatformIONotInstalledError();
          }
          throw secondError;
        }
      } else {
        throw firstError;
      }
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  } catch (error: any) {
    // Handle timeout
    if (error.killed && error.signal === "SIGTERM") {
      throw new CommandTimeoutError(args.join(" "), timeout);
    }

    // Handle not found
    if (isPlatformIONotFoundError(error)) {
      throw new PlatformIONotInstalledError();
    }

    // Handle execution error with exit code
    if (error.code && error.stdout !== undefined) {
      return {
        stdout: error.stdout || "",
        stderr: error.stderr || "",
        exitCode: error.code,
      };
    }

    throw error;
  }
}

/**
 * Parses JSON output from PlatformIO and validates with Zod schema.
 *
 * @param output - Raw JSON string from CLI stdout.
 * @param schema - Zod schema to validate against for type safety.
 * @returns The strongly typed validated object payload.
 */
export function parsePioJsonOutput<T>(
  output: string,
  schema: z.ZodSchema<T>,
): T {
  if (!output || output.trim().length === 0) {
    throw new PlatformIOError("Empty output from PlatformIO command");
  }

  try {
    const parsed = JSON.parse(output);
    return schema.parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new PlatformIOError(
        `Failed to parse PlatformIO output: ${error.message}`,
        "PARSE_ERROR",
        { zodError: error.issues, output: output.substring(0, 500) },
      );
    }
    if (error instanceof SyntaxError) {
      throw new PlatformIOError(
        `Invalid JSON output from PlatformIO: ${error.message}`,
        "INVALID_JSON",
        { output: output.substring(0, 500) },
      );
    }
    throw error;
  }
}

/**
 * Checks if PlatformIO CLI is installed and accessible.
 *
 * @returns True if PlatformIO is available in the environment path; false otherwise.
 */
export async function checkPlatformIOInstalled(): Promise<boolean> {
  try {
    const result = await execPioCommand(["--version"], { timeout: 5000 });
    return result.exitCode === 0 && result.stdout.includes("PlatformIO");
  } catch (error) {
    if (error instanceof PlatformIONotInstalledError) {
      return false;
    }
    throw error;
  }
}

/**
 * Gets the PlatformIO version.
 *
 * @returns The semantic version string of the local PlatformIO installation.
 */
export async function getPlatformIOVersion(): Promise<string> {
  try {
    const result = await execPioCommand(["--version"], { timeout: 5000 });
    if (result.exitCode === 0) {
      // Output format: "PlatformIO Core, version X.Y.Z"
      const match = result.stdout.match(/version\s+([\d\.]+)/i);
      return match ? match[1] : result.stdout.trim();
    }
    throw new PlatformIOError("Failed to get PlatformIO version");
  } catch (error) {
    if (error instanceof PlatformIONotInstalledError) {
      throw error;
    }
    throw new PlatformIOError("Failed to get PlatformIO version");
  }
}

/**
 * Class that encapsulates PlatformIO CLI operations
 */
export class PlatformIOExecutor {
  constructor() {}

  /**
   * Executes a PlatformIO command.
   *
   * @param command - The PIO subcommand string.
   * @param args - Arguments array for the command.
   * @param options - Execution directives for the child process.
   * @returns Structured runtime output results.
   */
  async execute(
    command: string,
    args: string[],
    options?: {
      cwd?: string;
      timeout?: number;
      onOutput?: (c: string) => void;
    },
  ): Promise<CommandResult> {
    const fullArgs = [command, ...args];
    return execPioCommand(fullArgs, options);
  }

  /**
   * Checks if PlatformIO is installed.
   *
   * @returns A boolean resolving true if PlatformIO is ready.
   */
  async checkInstallation(): Promise<boolean> {
    return checkPlatformIOInstalled();
  }

  /**
   * Gets PlatformIO version.
   *
   * @returns The resolved PIO version.
   */
  async getVersion(): Promise<string> {
    return getPlatformIOVersion();
  }

  /**
   * Executes a command and parses JSON output.
   *
   * @param command - Core PlatformIO subcommand logic.
   * @param args - Configuration and CLI flag values.
   * @param schema - Schema for JSON output validation.
   * @param options - Operational execution directives.
   * @returns Parsed and validated JSON node entity.
   */
  async executeWithJsonOutput<T>(
    command: string,
    args: string[],
    schema: z.ZodSchema<T>,
    options?: {
      cwd?: string;
      timeout?: number;
      onOutput?: (c: string) => void;
    },
  ): Promise<T> {
    // Ensure --json-output is included
    const fullArgs = [...args];
    if (!fullArgs.includes("--json-output")) {
      fullArgs.push("--json-output");
    }

    const result = await this.execute(command, fullArgs, options);

    if (result.exitCode !== 0) {
      throw new PlatformIOError(
        `PlatformIO command failed: ${command} ${args.join(" ")}`,
        "COMMAND_FAILED",
        { stderr: result.stderr, exitCode: result.exitCode },
      );
    }

    return parsePioJsonOutput(result.stdout, schema);
  }

  /**
   * Spawns a long-running PlatformIO command (e.g., monitor).
   * Implements the same binary resolution logic as 'execute'.
   *
   * @param command - The PIO subcommand.
   * @param args - Arguments array for the PlatformIO CLI.
   * @param options - Execution options including working directory, environment overrides, and fake TTY bridging.
   * @returns The spawned ChildProcess instance.
   */
  async spawn(
    command: string,
    args: string[],
    options: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      useFakeTty?: boolean;
      detached?: boolean;
      stdio?: any;
    } = {},
  ): Promise<ChildProcess> {
    let pioBinary = "pio";
    let pioArgs = [command, ...args];

    const env = {
      ...process.env,
      ...options.env,
    };

    // If a fake TTY is requested (macOS/Linux), wrap with our Python PTY bridge
    if (options.useFakeTty && process.platform !== "win32") {
      const absolutePio = resolvePioPath();
      const proxyScriptPath = path.join(
        __dirname,
        "..",
        "src",
        "utils",
        "mcp_pio_proxy.py",
      );

      pioBinary = "python3";
      pioArgs = [proxyScriptPath, absolutePio, command, ...args];
    }

    // Log the actual command being spawned for diagnostics
    const fullCmd = `${pioBinary} ${pioArgs.join(" ")}`;
    try {
      const logDir = path.join(__dirname, "..", "logs");
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      await fs.promises.appendFile(
        path.join(logDir, "mcp-internal.log"),
        `[${new Date().toISOString()}] [Spooler Executor] Spawning: ${fullCmd}\n`,
      );
    } catch (e) {
      console.error(`Failed to write to internal log: ${e}`);
    }

    // Consistent with execute(), we rely on environment inheritance.
    // shell: false ensures the environment isn't mangled by a sub-shell.
    return spawn(pioBinary, pioArgs, {
      cwd: options.cwd,
      env,
      shell: false,
      detached: options.detached,
      stdio: options.stdio,
    });
  }
}

/**
 * Global instance of PlatformIOExecutor for project-wide use.
 */
export const platformioExecutor = new PlatformIOExecutor();

/**
 * Resolves the absolute path to the PlatformIO binary.
 * Required for tools like 'script' that don't perform PATH resolution.
 */
import { execSync } from "node:child_process";

// ... Inside resolvePioPath

function resolvePioPath(): string {
  // Attempt to use system PATH natively first
  try {
    const whichCmd = os.platform() === "win32" ? "where pio" : "command -v pio";
    const out = execSync(whichCmd, { stdio: "pipe" }).toString().trim();
    if (out) {
      // Windows 'where' can return multiple paths, take the first valid one
      const paths = out.split('\n').map(p => p.trim()).filter(p => p.length > 0);
      for (const p of paths) {
        if (fs.existsSync(p)) return p;
      }
    }
  } catch (e) {
    // Ignore error if command -v OR where fails (e.g. not in PATH)
  }

  // Native check failed, fallback to extensive hardcoded probes
  if (os.platform() === "win32") {
    const winCandidate = path.join(os.homedir(), ".platformio", "penv", "Scripts", "pio.exe");
    if (fs.existsSync(winCandidate)) return winCandidate;
    return "pio"; // Fallback to PATH blindly
  }

  const candidates = [
    "/usr/local/bin/pio",
    "/opt/homebrew/bin/pio",
    "/usr/bin/pio",
    "/bin/pio",
    path.join(os.homedir(), ".platformio", "penv", "bin", "pio"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  
  return "pio"; // Ultimate fallback
}
