/**
 * Project Scaffolding Tools
 * Project initialization and management tools.
 *
 * Provides:
 * - initProject: Scaffolds a standardized PlatformIO context.
 * - isValidProject: Validates directory structural health.
 * - getProjectConfig: Parses configuration syntax schema.
 */

import { mkdir } from "fs/promises";
import path from "path";
import { platformioExecutor } from "../platformio.js";
import type { ProjectInitResult } from "../types.js";
import {
  validateBoardId,
  validateFramework,
  validateProjectPath,
  checkDirectoryExists,
} from "../utils/validation.js";
import { ProjectInitError } from "../utils/errors.js";

/**
 * Initializes a new PlatformIO project.
 *
 * @param config - The initialization scheme, requiring at least board and projectDir.
 * @returns Status string denoting success and generated filesystem paths.
 */
export async function initProject(config: {
  board: string;
  framework?: string;
  projectDir: string;
  platformOptions?: Record<string, string>;
}): Promise<ProjectInitResult> {
  // Validate inputs
  if (!validateBoardId(config.board)) {
    throw new ProjectInitError(`Invalid board ID: ${config.board}`, {
      board: config.board,
    });
  }

  if (config.framework && !validateFramework(config.framework)) {
    throw new ProjectInitError(`Invalid framework: ${config.framework}`, {
      framework: config.framework,
    });
  }

  let projectPath: string;
  try {
    projectPath = validateProjectPath(config.projectDir);
  } catch (error) {
    throw new ProjectInitError(`Invalid project directory: ${error}`, {
      projectDir: config.projectDir,
    });
  }

  try {
    // Create directory if it doesn't exist
    const dirExists = await checkDirectoryExists(projectPath);
    if (!dirExists) {
      await mkdir(projectPath, { recursive: true });
    }

    // Build command args
    const args: string[] = ["project", "init", "--board", config.board];

    // Add optional framework
    if (config.framework) {
      args.push("--project-option", `framework=${config.framework}`);
    }

    // Add additional platform options
    if (config.platformOptions) {
      for (const [key, value] of Object.entries(config.platformOptions)) {
        args.push("--project-option", `${key}=${value}`);
      }
    }

    // Execute init command in the project directory
    const result = await platformioExecutor.execute("project", args.slice(1), {
      cwd: projectPath,
      timeout: 120000,
    });

    if (result.exitCode !== 0) {
      throw new ProjectInitError(
        `Failed to initialize project: ${result.stderr}`,
        {
          board: config.board,
          stderr: result.stderr,
          exitCode: result.exitCode,
        },
      );
    }

    return {
      success: true,
      path: projectPath,
      message: `Successfully initialized PlatformIO project for board '${config.board}' at ${projectPath}`,
    };
  } catch (error) {
    if (error instanceof ProjectInitError) {
      throw error;
    }
    throw new ProjectInitError(`Failed to initialize project: ${error}`, {
      board: config.board,
      projectDir: config.projectDir,
    });
  }
}

/**
 * Checks if a directory is a valid PlatformIO project.
 *
 * @param projectDir - Evaluated project workspace folder path.
 * @returns Resolves true if a platformio.ini file is discovered.
 */
export async function isValidProject(projectDir: string): Promise<boolean> {
  try {
    const validatedPath = validateProjectPath(projectDir);
    const platformioIniPath = path.join(validatedPath, "platformio.ini");
    return await checkDirectoryExists(platformioIniPath);
  } catch {
    return false;
  }
}

/**
 * Gets project configuration from platformio.ini.
 *
 * @param projectDir - Validated platform path to retrieve configuration from.
 * @returns Nested map tree of raw string config block keys and variables.
 */
export async function getProjectConfig(
  projectDir: string,
): Promise<any> {
  const validatedPath = validateProjectPath(projectDir);

  try {
    const result = await platformioExecutor.executeWithJsonOutput(
      "project",
      ["config", "--json-output"],
      {
        cwd: validatedPath,
        timeout: 30000,
      }
    );
    return result;
  } catch (error) {
    throw new ProjectInitError(
      `Failed to get project configuration: ${error}`,
      { projectDir },
    );
  }
}

/**
 * Gets system diagnostic path output.
 *
 * @returns JSON payload of system information.
 */
export async function getSystemInfo(): Promise<any> {
  try {
    const result = await platformioExecutor.executeWithJsonOutput(
      "system",
      ["info", "--json-output"],
      { timeout: 30000 }
    );
    return result;
  } catch (error) {
    throw new Error(`Failed to get system info: ${error}`);
  }
}
