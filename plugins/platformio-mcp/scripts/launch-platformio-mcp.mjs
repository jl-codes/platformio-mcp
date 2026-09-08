/**
 * Launches the self-contained PlatformIO MCP runtime from an installed plugin.
 *
 * Provides:
 * - getLaunchSpec: Resolves the bundled runtime or version-pinned npm fallback.
 * - launchPlatformIOMcp: Starts the server with transparent stdio and signals.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGIN_ROOT = resolve(SCRIPT_DIR, "..");

/**
 * Tests whether two path spellings identify the same file.
 * macOS commonly aliases `/var` to `/private/var`, including its temp folder.
 * @param {string} left First path.
 * @param {string} right Second path.
 * @param {(path: string) => string} [canonicalize] Canonical path resolver.
 * @returns {boolean} Whether both paths resolve to the same file.
 */
export function pathsReferToSameFile(left, right, canonicalize = realpathSync) {
  try {
    return canonicalize(left) === canonicalize(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

/**
 * Resolves a launch command without spawning a shell.
 * @param {{ pluginRoot?: string, platform?: NodeJS.Platform, runtimeExists?: boolean }} [options] Launch overrides used by tests.
 * @returns {{ command: string, args: string[], env: NodeJS.ProcessEnv, source: "bundled" | "npm" }} Spawn-ready command details.
 */
export function getLaunchSpec(options = {}) {
  const pluginRoot = resolve(options.pluginRoot ?? DEFAULT_PLUGIN_ROOT);
  const platform = options.platform ?? process.platform;
  const runtimeEntry = join(pluginRoot, "runtime", "platformio-mcp.mjs");
  const webDist = join(pluginRoot, "runtime", "web");
  const hasRuntime = options.runtimeExists ?? existsSync(runtimeEntry);
  const manifest = JSON.parse(
    readFileSync(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"),
  );
  const packageVersion = String(manifest.version).split("+")[0];
  const env = {
    ...process.env,
    PIO_MCP_NO_BROWSER: process.env.PIO_MCP_NO_BROWSER ?? "true",
    PIO_MCP_WEB_DIST: webDist,
  };

  if (hasRuntime) {
    return {
      command: process.execPath,
      args: [runtimeEntry, ...process.argv.slice(2)],
      env,
      source: "bundled",
    };
  }

  return {
    command: platform === "win32" ? "npx.cmd" : "npx",
    args: ["-y", `platformio-mcp@${packageVersion}`, ...process.argv.slice(2)],
    env,
    source: "npm",
  };
}

/**
 * Starts the PlatformIO MCP process and forwards termination and exit state.
 * @param {ReturnType<typeof getLaunchSpec>} [spec] Optional pre-resolved launch details.
 * @returns {import("node:child_process").ChildProcess} Running child process.
 */
export function launchPlatformIOMcp(spec = getLaunchSpec()) {
  if (process.env.PIO_MCP_PLUGIN_DEBUG === "true") {
    console.error(
      `[platformio-mcp plugin] Launching ${spec.source} runtime with ${spec.command}.`,
    );
  }
  const child = spawn(spec.command, spec.args, {
    cwd: DEFAULT_PLUGIN_ROOT,
    env: spec.env,
    shell: false,
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  });

  if (!child.stdin || !child.stdout) {
    throw new Error("PlatformIO MCP child process did not expose stdio pipes.");
  }
  process.stdin.pipe(child.stdin);
  child.stdout.pipe(process.stdout);

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));
  child.once("error", (error) => {
    console.error(`[platformio-mcp plugin] Failed to launch: ${error.message}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.stdin.unpipe(child.stdin);
    child.stdout?.unpipe(process.stdout);
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    if (process.env.PIO_MCP_PLUGIN_DEBUG === "true") {
      console.error(
        `[platformio-mcp plugin] Runtime exited with code ${code ?? 1}.`,
      );
    }
    process.exitCode = code ?? 1;
  });

  return child;
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  pathsReferToSameFile(invokedPath, fileURLToPath(import.meta.url))
) {
  launchPlatformIOMcp();
}
