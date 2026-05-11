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
import fs from "node:fs";
import path from "path";
import { z } from "zod";
import { platformioExecutor } from "../platformio.js";
import type { ProjectContext, ProjectInitResult } from "../types.js";
import {
  validateBoardId,
  validateFramework,
  validateProjectPath,
  checkDirectoryExists,
} from "../utils/validation.js";
import { ProjectInitError } from "../utils/errors.js";
import {
  lookupBuildCache,
  findFirmwareArtifact,
} from "../utils/build-cache.js";

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
      z.any(),
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
      z.any(),
      { timeout: 30000 }
    );
    return result;
  } catch (error) {
    throw new Error(`Failed to get system info: ${error}`);
  }
}

// ---------------------------------------------------------------------------
// get_project_context
// ---------------------------------------------------------------------------
// EmbedBench traces (see embedbench/runner logs) showed agents performing a
// small but very predictable ritual at the start of every iteration:
//   1. `read_file platformio.ini`
//   2. `list_files src/`
//   3. `read_file src/main.cpp` (or whichever entry was edited)
//   4. `list_devices` to find a port
//   5. (sometimes) cat the last build log
// That's 4–5 MCP/tool round-trips before the first real piece of work.
// Each round-trip is ≥1 second of agent latency (LLM call + tool execute)
// and consumes context tokens. We collapse the whole pre-flight into a
// single deterministic call below. It is intentionally a *thin* reader —
// no `pio` invocations, no daemons — so it's safe to call repeatedly.

const PLATFORMIO_INI_ENV_RE = /^\s*\[env:([^\]\s]+)\]\s*$/gm;
const MAX_SRC_FILES = 50;

/**
 * Recursively collects relative paths of files under `src/`, capped at
 * `MAX_SRC_FILES` entries. Ordering is stable (alphabetical) so repeated
 * calls produce deterministic output. Returns an empty array if `src/`
 * is missing — the caller still gets a useful context shape.
 */
function listSourceFiles(projectDir: string): string[] {
  const root = path.join(projectDir, "src");
  const out: string[] = [];

  function walk(dir: string, rel: string) {
    if (out.length >= MAX_SRC_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_SRC_FILES) return;
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, relPath);
      else if (entry.isFile()) out.push(`src/${relPath}`);
    }
  }

  if (fs.existsSync(root)) walk(root, "");
  return out;
}

/**
 * Minimal INI scanner that extracts environment names and `lib_deps` blocks.
 * We deliberately avoid spawning `pio project config` here because:
 *   (a) it adds 1–3s of latency per call (Python interpreter warmup);
 *   (b) it requires PIO to be installed/configured, which is the *thing*
 *       the agent might be debugging.
 * The trade-off is that we only extract a syntactic subset, not the
 * fully-resolved config. That's fine for an orientation tool.
 */
function parsePlatformioIni(iniText: string): {
  environments: string[];
  libDeps: string[];
} {
  const environments: string[] = [];
  let m: RegExpExecArray | null;
  // Reset stateful regex
  PLATFORMIO_INI_ENV_RE.lastIndex = 0;
  while ((m = PLATFORMIO_INI_ENV_RE.exec(iniText)) !== null) {
    environments.push(m[1]);
  }

  // Line-based lib_deps extraction. We avoid a single multiline regex here
  // because the `m`-flag `$` anchor terminates the lazy capture after the
  // first lib_deps value line, which previously truncated multi-entry
  // blocks like:
  //     lib_deps =
  //         bblanchon/ArduinoJson@^6.21.0
  //         adafruit/Adafruit GFX Library@^1.11.5
  // The state machine below is small, allocation-free per line, and
  // tolerates the INI continuation conventions PlatformIO actually uses
  // (indented follow-on lines, blank lines, section headers as terminators).
  const libDeps: string[] = [];
  const lines = iniText.split(/\r?\n/);
  let inLibDeps = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/[\t ]+$/, "");
    const trimmed = line.trim();

    // Section header always terminates a continuation block.
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
      inLibDeps = false;
      continue;
    }

    if (!inLibDeps) {
      const start = /^\s*lib_deps\s*=\s*(.*)$/.exec(line);
      if (start) {
        inLibDeps = true;
        // Inline value on the same line, e.g. `lib_deps = ArduinoJson`.
        const inline = start[1].trim();
        if (inline) libDeps.push(inline);
      }
      continue;
    }

    // Inside the lib_deps block.
    if (!trimmed) continue;
    if (trimmed.startsWith(";") || trimmed.startsWith("#")) continue;
    // A new top-level key=value (non-indented) closes the block.
    const isContinuation = /^[\t ]/.test(rawLine);
    const looksLikeKey = /^[a-zA-Z0-9_]+\s*=/.test(trimmed);
    if (!isContinuation && looksLikeKey) {
      inLibDeps = false;
      continue;
    }
    libDeps.push(trimmed);
  }
  return { environments, libDeps };
}

/**
 * Reads the most recent latest-build.log (if any) and returns its status
 * inference. Lightweight: only inspects the tail of the file so we don't
 * pay for megabytes of verbose logs.
 */
function inferLastBuild(
  projectDir: string,
): { status: string; logPath?: string } | undefined {
  const logFile = path.join(
    projectDir,
    ".pio-mcp-workspace",
    "logs",
    "build",
    "latest-build.log",
  );
  if (!fs.existsSync(logFile)) return undefined;
  let tail = "";
  try {
    const buf = fs.readFileSync(logFile);
    tail = buf.slice(Math.max(0, buf.length - 4096)).toString("utf8");
  } catch {
    return { status: "unknown", logPath: logFile };
  }
  if (/\[SUCCESS\]|SUCCESS:/i.test(tail)) {
    return { status: "succeeded", logPath: logFile };
  }
  if (/\[FAILED\]|FAILED:|error:/i.test(tail)) {
    return { status: "failed", logPath: logFile };
  }
  return { status: "unknown", logPath: logFile };
}

/**
 * Builds the orientation tip list. Encodes the most common bootstrap
 * mistakes agents made in EmbedBench: skipping init, hard-coding env,
 * forgetting to list devices before upload.
 */
function buildContextNextSteps(ctx: Partial<ProjectContext>): string[] {
  const tips: string[] = [];
  if (!ctx.hasPlatformioIni) {
    tips.push(
      "platformio.ini is missing — call `init_project` with the desired board ID first, then re-run `get_project_context`.",
    );
    return tips;
  }
  if (!ctx.environments || ctx.environments.length === 0) {
    tips.push(
      "platformio.ini exists but declares no `[env:*]` sections — add at least one environment before building.",
    );
  } else if (ctx.environments.length > 1) {
    tips.push(
      `Multiple environments declared (${ctx.environments.join(", ")}). Pass the desired one explicitly as the \`environment\` argument to \`build_project\` / \`upload_firmware\`.`,
    );
  }
  if ((ctx.sourceFiles?.length ?? 0) === 0) {
    tips.push(
      "No source files found under `src/`. Create at least one .c/.cpp/.ino entry point before building.",
    );
  }
  if (ctx.cacheReady && ctx.firmwarePath) {
    tips.push(
      "Build cache is warm — `build_project` will return instantly from cache. Call `upload_firmware` to flash, or edit source files to force a rebuild.",
    );
  } else {
    tips.push(
      "No warm build cache — first `build_project` call will perform a full toolchain run.",
    );
  }
  if ((ctx.connectedDevices?.length ?? 0) === 0) {
    tips.push(
      "No serial devices detected. Plug in the board (or rerun `list_devices`) before invoking `upload_firmware`.",
    );
  }
  return tips;
}

/**
 * Returns a structured pre-flight snapshot of the project: env list, source
 * files, lib_deps, cache state, connected devices, last build status. Designed
 * to be the first MCP tool an agent invokes when picking up a new task, in
 * place of the typical 4–5 manual file-read tool calls.
 *
 * Pure I/O over the project directory + a single optional `pio device list`
 * for connectedDevices — no toolchain work, no daemons. Safe to call as
 * often as the agent wants.
 *
 * @param projectDir - Absolute or relative path to the PlatformIO project.
 * @param includeBuildHistory - Whether to inspect `latest-build.log`.
 */
export async function getProjectContext(
  projectDir: string,
  includeBuildHistory?: boolean,
): Promise<ProjectContext> {
  const validatedPath = validateProjectPath(projectDir);
  const iniPath = path.join(validatedPath, "platformio.ini");
  const hasPlatformioIni = fs.existsSync(iniPath);

  // Lazy-imported to avoid widening the dep graph of this hot path; the
  // device tool already exists and we just want its array. Errors here are
  // non-fatal — the orientation tool should never throw on a present-but-
  // imperfect environment.
  let connectedDevices: ProjectContext["connectedDevices"];
  try {
    const { listDevices } = await import("./devices.js");
    const devs = await listDevices();
    connectedDevices = devs.map((d) => ({
      port: d.port,
      description: d.description,
      detectedBoard: d.detectedBoard,
    }));
  } catch {
    connectedDevices = [];
  }

  let environments: string[] | undefined;
  let libDeps: string[] | undefined;
  if (hasPlatformioIni) {
    try {
      const text = fs.readFileSync(iniPath, "utf8");
      const parsed = parsePlatformioIni(text);
      environments = parsed.environments;
      libDeps = parsed.libDeps;
    } catch {
      // Treat as if file is unreadable — leave fields undefined.
    }
  }

  const defaultEnvironment = environments?.[0];
  const cacheEnv = defaultEnvironment || "default";
  const lookup = lookupBuildCache(validatedPath, cacheEnv);
  const cacheReady = lookup.hit;
  const firmwarePath = cacheReady
    ? lookup.entry.firmwarePath
    : findFirmwareArtifact(validatedPath, cacheEnv);

  const sourceFiles = listSourceFiles(validatedPath);

  const lastBuild = includeBuildHistory ? inferLastBuild(validatedPath) : undefined;

  const partial: Partial<ProjectContext> = {
    projectDir: validatedPath,
    hasPlatformioIni,
    environments,
    defaultEnvironment,
    sourceFiles,
    libDeps,
    cacheReady,
    firmwarePath,
    connectedDevices,
    lastBuild,
  };

  return {
    projectDir: validatedPath,
    hasPlatformioIni,
    environments,
    defaultEnvironment,
    sourceFiles,
    libDeps,
    cacheReady,
    firmwarePath,
    connectedDevices,
    lastBuild,
    nextSteps: buildContextNextSteps(partial),
  };
}
