/**
 * Build Execution Tools
 * Project build and compilation tools.
 *
 * Provides:
 * - buildProject: Compiles firmware binaries.
 * - cleanProject: Scrubs compilation artifacts.
 * - buildTarget: Compiles specific PIO lifecycle targets.
 * - listTargets: Discovers valid compilation targets.
 */

import { platformioExecutor } from "../platformio.js";
import { executeWithSpooling } from "../utils/spooler.js";
import type { BuildResult, CleanResult } from "../types.js";
import {
  validateProjectPath,
  validateEnvironmentName,
} from "../utils/validation.js";
import { BuildError, PlatformIOError } from "../utils/errors.js";
import { parseStderrErrors } from "../utils/errors.js";
import { isBuildActive } from "../utils/process-manager.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";


/**
 * Builds a PlatformIO project.
 *
 * @param projectDir - The target location of the PIO project.
 * @param environment - Optional specific platformio.ini environment target.
 * @param verbose - If true, returns the complete verbose build log in the result instead of truncating it.
 * @returns Resulting build status and output log payloads.
 */
export async function buildProject(
  projectDir: string,
  environment?: string,
  verbose?: boolean,
  background?: boolean,
): Promise<BuildResult> {
  const validatedPath = validateProjectPath(projectDir);

  if (environment && !validateEnvironmentName(environment)) {
    throw new BuildError(`Invalid environment name: ${environment}`, {
      environment,
    });
  }

  try {
    const args: string[] = [];

    // Add environment if specified
    if (environment) {
      args.push("--environment", environment);
    }


    // Build can take a while, especially first time
    const result = await executeWithSpooling("run", args, {
      cwd: validatedPath,
      projectDir: validatedPath,
      timeout: 600000, // 10 minutes
      background
    });

    if (background) {
      return result as BuildResult;
    }

    const success = result.exitCode === 0;
    const errors = success ? undefined : parseStderrErrors(result.finalOutput);

    let ramUsageBytes: number | undefined;
    let flashUsageBytes: number | undefined;

    if (success) {
      const ramMatch = result.finalOutput.match(/RAM:.*?used\s+(\d+)\s+bytes/i);
      if (ramMatch) ramUsageBytes = parseInt(ramMatch[1], 10);

      const flashMatch = result.finalOutput.match(/Flash:.*?used\s+(\d+)\s+bytes/i);
      if (flashMatch) flashUsageBytes = parseInt(flashMatch[1], 10);
    }

    return {
      success,
      environment: environment || "default",
      output: success && !verbose ? undefined : result.finalOutput,
      errors,
      ramUsageBytes,
      flashUsageBytes,
    };
  } catch (error) {
    if (error instanceof PlatformIOError) {
      throw new BuildError(`Build failed: ${error.message}`, {
        projectDir,
        environment,
      });
    }
    throw new BuildError(`Failed to build project: ${error}`, {
      projectDir,
      environment,
    });
  }
}

/**
 * Cleans build artifacts from a project.
 *
 * @param projectDir - Discard compilation output for this project workspace.
 * @returns Indicates successful cleanup execution metadata.
 */
export async function cleanProject(projectDir: string, background?: boolean): Promise<CleanResult> {
  const validatedPath = validateProjectPath(projectDir);

  try {
    const result = await executeWithSpooling(
      "run",
      ["--target", "clean"],
      {
        cwd: validatedPath,
        projectDir: validatedPath,
        timeout: 60000,
        background
      },
    );

    if (background) {
      return result;
    }

    const success = result.exitCode === 0;

    if (!success) {
      throw new BuildError(`Clean failed: ${result.finalOutput}`, {
        projectDir,
        stderr: result.finalOutput,
      });
    }

    return {
      success: true,
      message: "Successfully cleaned build artifacts",
    };
  } catch (error) {
    if (error instanceof BuildError) {
      throw error;
    }
    throw new BuildError(`Failed to clean project: ${error}`, { projectDir });
  }
}

/**
 * Builds project for a specific target (e.g., 'upload', 'monitor', 'test').
 *
 * @param projectDir - Project workspace to run the target against.
 * @param target - Build operation target designation.
 * @param environment - Associated subset configuration to use.
 * @param verbose - If true, returns full output payload instead of truncating on success.
 * @returns Completed build execution status outcome.
 */
export async function buildTarget(
  projectDir: string,
  target: string,
  environment?: string,
  verbose?: boolean,
): Promise<BuildResult> {
  const validatedPath = validateProjectPath(projectDir);

  if (environment && !validateEnvironmentName(environment)) {
    throw new BuildError(`Invalid environment name: ${environment}`, {
      environment,
    });
  }

  try {
    const args: string[] = ["--target", target];

    if (environment) {
      args.push("--environment", environment);
    }


    const result = await executeWithSpooling("run", args, {
      cwd: validatedPath,
      projectDir: validatedPath,
      timeout: 600000,
    });

    const success = result.exitCode === 0;
    const errors = success ? undefined : parseStderrErrors(result.finalOutput);

    let ramUsageBytes: number | undefined;
    let flashUsageBytes: number | undefined;

    if (success) {
      const ramMatch = result.finalOutput.match(/RAM:.*?used\s+(\d+)\s+bytes/i);
      if (ramMatch) ramUsageBytes = parseInt(ramMatch[1], 10);

      const flashMatch = result.finalOutput.match(/Flash:.*?used\s+(\d+)\s+bytes/i);
      if (flashMatch) flashUsageBytes = parseInt(flashMatch[1], 10);
    }

    return {
      success,
      environment: environment || "default",
      output: success && !verbose ? undefined : result.finalOutput,
      errors,
      ramUsageBytes,
      flashUsageBytes,
    };
  } catch (error) {
    if (error instanceof PlatformIOError) {
      throw new BuildError(`Target '${target}' failed: ${error.message}`, {
        projectDir,
        target,
        environment,
      });
    }
    throw new BuildError(`Failed to build target '${target}': ${error}`, {
      projectDir,
      target,
      environment,
    });
  }
}

/**
 * Gets list of available build targets for a project.
 *
 * @param projectDir - Applicable initialized source map directory.
 * @param environment - Particular platform configuration to read targets from.
 * @returns Plain array strings of build execution routines.
 */
export async function listTargets(
  projectDir: string,
  environment?: string,
): Promise<string[]> {
  const validatedPath = validateProjectPath(projectDir);

  try {
    const args: string[] = ["--list-targets"];

    if (environment) {
      args.push("--environment", environment);
    }

    const result = await platformioExecutor.execute("run", args, {
      cwd: validatedPath,
      timeout: 30000,
    });

    if (result.exitCode !== 0) {
      throw new BuildError("Failed to list targets", {
        projectDir,
        stderr: result.stderr,
      });
    }

    // Parse target list from output
    const targets: string[] = [];
    const lines = result.stdout.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      // Targets are typically listed one per line
      if (
        trimmed &&
        !trimmed.startsWith("Environment") &&
        !trimmed.includes(":")
      ) {
        targets.push(trimmed);
      }
    }

    return targets;
  } catch (error) {
    if (error instanceof BuildError) {
      throw error;
    }
    throw new BuildError(`Failed to list build targets: ${error}`, {
      projectDir,
    });
  }
}

/**
 * Polling tool to check background task status and return recent logs.
 */
export async function checkTaskStatus(projectDir?: string) {
  const baseDir = projectDir || os.tmpdir();
  const WORKSPACE_DIR = ".pio-mcp-workspace";
  const LOGS_DIR = "build_logs";
  const logFile = path.join(baseDir, WORKSPACE_DIR, LOGS_DIR, "latest-build.log");
  
  const active = isBuildActive(projectDir);

  let finalOutput = "";
  if (fs.existsSync(logFile)) {
    try {
      const content = fs.readFileSync(logFile, "utf-8");
      const lines = content.split("\n");
      if (active) {
        finalOutput = lines.slice(-30).join("\n");
      } else {
        finalOutput = lines.slice(-150).join("\n");
      }
    } catch (e: any) {
      finalOutput = `[Status Polling Error] Could not read log: ${e.message}`;
    }
  } else {
    finalOutput = "No active build log found.";
  }

  let taskStatus = active ? "running" : "completed";
  
  if (!active && finalOutput.includes("FAILED")) {
     taskStatus = "failed";
  } else if (!active && finalOutput.includes("Error:")) {
     taskStatus = "failed";
  }

  return {
    status: taskStatus,
    logTail: finalOutput
  };
}
