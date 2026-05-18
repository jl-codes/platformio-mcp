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
import {
  parseStderrErrors,
  parseStructuredBuildErrors,
  deriveNextSteps,
} from "../utils/errors.js";
import { isBuildActive } from "../utils/process-manager.js";
import fs from "node:fs";

import path from "node:path";
import crypto from "node:crypto";
import { tailFileBounded } from "../utils/tail.js";
import { SERVER_DATA_DIR, ensureGlobalDirs } from "../utils/paths.js";
import { mcpContext } from "../utils/mcp-context.js";
import {
  lookupBuildCache,
  writeCache,
  findFirmwareArtifact,
  invalidateBuildCache,
} from "../utils/build-cache.js";
import { logDiagnostic as logDiag } from "../utils/logger.js";
import { redactSecretsInText } from "../core/policy/redact.js";
import { diagnoseBuildLog } from "../core/diagnostics/build-diagnostics.js";
import { diagnoseUploadLog } from "../core/diagnostics/upload-diagnostics.js";
import { diagnoseSerialLog } from "../core/diagnostics/serial-diagnostics.js";
import type { DiagnosticResult } from "../core/diagnostics/types.js";
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
  const rootCommandId = mcpContext.getStore()?.activityId || crypto.randomUUID();
  const validatedPath = validateProjectPath(projectDir);

  if (environment && !validateEnvironmentName(environment)) {
    throw new BuildError(`Invalid environment name: ${environment}`, {
      environment,
    });
  }

  // ----------------------------------------------------------------------------
  // 1. Content-hash cache short-circuit.
  //
  // EmbedBench traces showed agents re-invoking `build_project` after edits that
  // did not actually change disk content (e.g. saving the same file again, or
  // running an evaluation loop with k repeated trials). Each rebuild paid the
  // 30–120 s pio toolchain warmup with zero compilation work to do. Hashing
  // src/include/lib/platformio.ini once is microseconds; on a hit we replay
  // the prior result directly. Skipped when `background=true` because the
  // caller is asking explicitly for an asynchronous dispatch contract — we
  // honor it instead of confusingly returning a synchronous result. Also
  // skipped on `verbose=true`: callers asking for full verbose logs usually
  // want fresh ones from the compiler, not a cached tail.
  // ----------------------------------------------------------------------------
  const envName = environment || "default";
  if (!background && !verbose) {
    const lookup = lookupBuildCache(validatedPath, envName);
    if (lookup.hit) {
      const cached = lookup.entry;
      const tail = cached.finalOutputTail || "(cached build — output omitted)";
      const structuredErrors = parseStructuredBuildErrors(tail);
      logDiag(
        `[buildProject] Cache hit for ${validatedPath} (env=${envName}, hash=${cached.inputsHash.slice(0, 12)}…) — skipping pio run`,
        validatedPath,
      );
      return {
        success: true,
        cacheHit: true,
        environment: envName,
        output: undefined,
        errors: undefined,
        structuredErrors,
        nextSteps: deriveNextSteps([], true).concat([
          "Build was served from MCP content-hash cache (no compilation work performed). Call `clean_project` or edit source files to force a rebuild.",
        ]),
        ramUsageBytes: cached.ramUsageBytes,
        flashUsageBytes: cached.flashUsageBytes,
        firmwarePath: cached.firmwarePath,
        diagnostic: diagnoseBuildLog(tail, {
          success: true,
        }),
      };
    }
  }

  try {
    const args: string[] = [];

    // Add environment if specified
    if (environment) {
      args.push("--environment", environment);
    }

    // Add verbose flag if requested
    if (verbose) {
      args.push("--verbose");
    }

    // Build can take a while, especially first time
    const result = await executeWithSpooling("run", args, {
      cwd: validatedPath,
      projectDir: validatedPath,
      timeout: background ? 3600000 : 600000, // 1 hour for background, 10 mins for foreground
      background,
      rootCommandId
    });

    if ('status' in result) {
      // Background dispatch: caller will poll. Don't try to cache an in-flight
      // build — the spooler will update its own state on completion.
      return result as unknown as BuildResult;
    }

    const success = result.exitCode === 0;
    const safeOutput = redactSecretsInText(result.finalOutput);
    const legacyErrors = success ? undefined : parseStderrErrors(safeOutput);
    const structuredErrors = parseStructuredBuildErrors(safeOutput);
    const nextSteps = deriveNextSteps(
      // Convert from internal StructuredBuildError to the JSON-friendly shape.
      structuredErrors,
      success,
    );
    const diagnostic = diagnoseBuildLog(safeOutput, {
      rawLogPath: result.fullLogPath,
      success: success,
    });

    let ramUsageBytes: number | undefined;
    let flashUsageBytes: number | undefined;
    let firmwarePath: string | undefined;

    if (success) {
      const ramMatch = safeOutput.match(/RAM:.*?used\s+(\d+)\s+bytes/i);
      if (ramMatch) ramUsageBytes = parseInt(ramMatch[1], 10);

      const flashMatch = safeOutput.match(/Flash:.*?used\s+(\d+)\s+bytes/i);
      if (flashMatch) flashUsageBytes = parseInt(flashMatch[1], 10);

      firmwarePath = findFirmwareArtifact(validatedPath, envName);

      // Persist the cache only on success. Failures get nothing to replay.
      // We trim the log to a tail (last ~16KB) so the cache file stays small —
      // we mostly need it for displaying RAM/Flash on hits, not for re-parsing.
      const tail = safeOutput.slice(-16 * 1024);
      // Recompute the input fingerprint *after* the build to capture any
      // generated headers or partial-write states the toolchain may have
      // touched under src/. lookupBuildCache returns the hash in both the
      // hit and miss branches of its discriminated union, so we can read it
      // unconditionally without an unsafe cast.
      const postBuildLookup = lookupBuildCache(validatedPath, envName);
      writeCache(validatedPath, {
        inputsHash: postBuildLookup.inputsHash,
        environment: envName,
        builtAtMs: Date.now(),
        firmwarePath,
        ramUsageBytes,
        flashUsageBytes,
        finalOutputTail: tail,
      });
    } else {
      // A failed build invalidates any older cache entry to prevent a
      // confusing "fresh failure but stale success cached" state.
      invalidateBuildCache(validatedPath);
    }

    return {
      success,
      cacheHit: false,
      environment: envName,
      output: success && !verbose ? undefined : safeOutput,
      errors: legacyErrors,
      structuredErrors,
      nextSteps,
      ramUsageBytes,
      flashUsageBytes,
      firmwarePath,
      rawLogPath: result.fullLogPath,
      diagnostic,
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
 * Runs static analysis on a PlatformIO project.
 *
 * @param projectDir - The target location of the PIO project.
 * @param environment - Optional specific platformio.ini environment target.
 * @param background - If true, dispatches the execution to the background.
 * @returns Resulting status payload.
 */
export async function checkProject(
  projectDir: string,
  environment?: string,
  background?: boolean,
): Promise<BuildResult> {
  const rootCommandId = mcpContext.getStore()?.activityId || crypto.randomUUID();
  const validatedPath = validateProjectPath(projectDir);

  if (environment && !validateEnvironmentName(environment)) {
    throw new BuildError(`Invalid environment name: ${environment}`, { environment });
  }

  try {
    const args: string[] = [];
    if (environment) {
      args.push("--environment", environment);
    }

    const result = await executeWithSpooling("check", args, {
      cwd: validatedPath,
      projectDir: validatedPath,
      timeout: background ? 3600000 : 600000,
      background,
      rootCommandId,
      artifactType: "check" as any, // "check" is handled cleanly by spooler
    });

    if ('status' in result) {
      return result as unknown as BuildResult;
    }

    const success = result.exitCode === 0;
    const errors = success ? undefined : parseStderrErrors(result.finalOutput);

    return {
      success,
      environment: environment || "default",
      output: result.finalOutput,
      errors,
    };
  } catch (error) {
    if (error instanceof PlatformIOError) {
      throw new BuildError(`Check failed: ${error.message}`, { projectDir, environment });
    }
    throw new BuildError(`Failed to check project: ${error}`, { projectDir, environment });
  }
}

/**
 * Runs unit tests on a PlatformIO project.
 *
 * @param projectDir - The target location of the PIO project.
 * @param environment - Optional specific platformio.ini environment target.
 * @param background - If true, dispatches the execution to the background.
 * @returns Resulting status payload.
 */
export async function runTests(
  projectDir: string,
  environment?: string,
  background?: boolean,
): Promise<BuildResult> {
  const rootCommandId = mcpContext.getStore()?.activityId || crypto.randomUUID();
  const validatedPath = validateProjectPath(projectDir);

  if (environment && !validateEnvironmentName(environment)) {
    throw new BuildError(`Invalid environment name: ${environment}`, { environment });
  }

  try {
    const args: string[] = [];
    if (environment) {
      args.push("--environment", environment);
    }

    const result = await executeWithSpooling("test", args, {
      cwd: validatedPath,
      projectDir: validatedPath,
      timeout: background ? 3600000 : 600000,
      background,
      artifactType: "test",
      rootCommandId
    });

    if ('status' in result) {
      return result as unknown as BuildResult;
    }

    const success = result.exitCode === 0;
    const errors = success ? undefined : parseStderrErrors(result.finalOutput);

    return {
      success,
      environment: environment || "default",
      output: result.finalOutput,
      errors,
    };
  } catch (error) {
    if (error instanceof PlatformIOError) {
      throw new BuildError(`Tests failed: ${error.message}`, { projectDir, environment });
    }
    throw new BuildError(`Failed to run tests: ${error}`, { projectDir, environment });
  }
}

/**
 * Cleans build artifacts from a project.

 *
 * @param projectDir - Discard compilation output for this project workspace.
 * @returns Indicates successful cleanup execution metadata.
 */
export async function cleanProject(projectDir: string, background?: boolean): Promise<CleanResult> {
  const rootCommandId = mcpContext.getStore()?.activityId || crypto.randomUUID();
  const validatedPath = validateProjectPath(projectDir);

  // Any user-initiated clean must wipe our cache; otherwise the next
  // `build_project` would short-circuit and return "success" without
  // rebuilding artifacts the user just asked to delete.
  invalidateBuildCache(validatedPath);

  try {
    const result = await executeWithSpooling(
      "run",
      ["--target", "clean"],
      {
        cwd: validatedPath,
        projectDir: validatedPath,
        timeout: 60000,
        background,
        rootCommandId
      },
    );

    if ('status' in result) {
      return result as unknown as CleanResult;
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

    if (verbose) {
      args.push("--verbose");
    }

    const result = await executeWithSpooling("run", args, {
      cwd: validatedPath,
      projectDir: validatedPath,
      timeout: 600000,
    });

    if ('status' in result) {
      return result as unknown as BuildResult;
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

    if ((result as any).exitCode !== 0) {
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

import { getCommandHistory } from "../utils/command-registry.js";

/**
 * Polling tool to check background task status and return recent logs.
 */
export async function checkTaskStatus(taskId?: string, logPath?: string, projectDir?: string) {
  const baseDir = projectDir || SERVER_DATA_DIR;
  if (!projectDir) ensureGlobalDirs();
  
  const history = getCommandHistory(baseDir);
  let resolvedTaskId = taskId;

  // 1. Reverse Lookup by logPath
  if (!resolvedTaskId && logPath) {
    for (const cmd of history) {
      const match = cmd.tasks?.find(t => t.logPaths?.includes(logPath));
      if (match) {
        resolvedTaskId = cmd.id; // Command ID acts as the primary task reference
        break;
      }
    }
  }

  // 2. Smart Fallback if still no taskId
  if (!resolvedTaskId) {
    for (let i = history.length - 1; i >= 0; i--) {
      const cmd = history[i];
      if (cmd.tasks && cmd.tasks.length > 0) {
        resolvedTaskId = cmd.id;
        break;
      }
    }
  }

  let status = "completed";
  let output = "No output available.";
  let logPaths: string[] = [];
  let diagnostic: DiagnosticResult | undefined;

  // 3. Unified Execution
  if (resolvedTaskId) {
    const cmd = history.find(c => c.id === resolvedTaskId);
    if (cmd) {
      status = cmd.status;
      logPaths = cmd.tasks
        .flatMap(a => a.logPaths || [])
        .filter((f): f is string => Boolean(f));
      
      const latestLog = logPath || logPaths[logPaths.length - 1];
      if (latestLog && fs.existsSync(latestLog)) {
         try {
           const lines = await tailFileBounded(latestLog, 512 * 1024);
           output = lines.slice(status === "running" ? -30 : -150).join("\n");
         } catch(e: any) {
           output = `[Status Polling Error] Could not read log: ${e.message}`;
         }
      } else if (latestLog) {
         output = `Log file not found: ${latestLog}`;
      }
    } else {
       status = "failed";
       output = `Task ID not found: ${resolvedTaskId}`;
    }
  } else {
    // Absolute legacy fallback
    const logFile = path.join(baseDir, ".pio-mcp-workspace", "logs", "build", "latest-build.log");
    const active = isBuildActive(projectDir);
    status = active ? "running" : "completed";
    if (fs.existsSync(logFile)) {
      logPaths = [logFile];
      try {
        const lines = await tailFileBounded(logFile, 512 * 1024);
        output = lines.slice(active ? -30 : -150).join("\n");
      } catch (e: any) {
        output = `[Status Polling Error] Could not read log: ${e.message}`;
      }
    } else {
      output = "No active task or build log found.";
    }

    if (!active && output.includes("FAILED")) status = "failed";
    else if (!active && output.includes("Error:")) status = "failed";
  }

  const safeOutput = redactSecretsInText(output);
  const effectiveLogPath = logPath || logPaths[logPaths.length - 1];
  const normalizedStatus = status.toLowerCase();
  const command = resolvedTaskId ? history.find((c) => c.id === resolvedTaskId) : undefined;
  const taskType = command?.tasks?.[0]?.type ?? "build";
  const successByStatus = normalizedStatus === "success" || normalizedStatus === "completed";
  const failedByStatus =
    normalizedStatus === "error" ||
    normalizedStatus === "failed" ||
    normalizedStatus === "terminated";

  if (taskType === "upload") {
    diagnostic = diagnoseUploadLog(safeOutput, {
      taskId: resolvedTaskId,
      rawLogPath: effectiveLogPath,
      success: successByStatus && !failedByStatus,
    });
  } else if (taskType === "monitor") {
    diagnostic = diagnoseSerialLog(safeOutput, {
      taskId: resolvedTaskId,
      rawLogPath: effectiveLogPath,
      success: successByStatus && !failedByStatus,
    });
  } else {
    diagnostic = diagnoseBuildLog(safeOutput, {
      taskId: resolvedTaskId,
      rawLogPath: effectiveLogPath,
      success: successByStatus && !failedByStatus,
    });
  }

  return {
    status: "success",
    targetStatus: status,
    taskId: resolvedTaskId,
    logPaths,
    output: safeOutput,
    diagnostic,
  };
}
