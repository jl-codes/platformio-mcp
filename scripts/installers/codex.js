import { mcpServerConfigBlock } from "./_shared.js";
/**
 * Codex MCP and plugin installers.
 * TOML syntax-tree edits preserve permissions, server options and other entries.
 * Invalid configuration is rejected without rewriting the file.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  mergeCodexToml,
  resolveCodexConfigPath,
  findBlockRange,
} from "./codex-config.js";
export { mergeCodexToml, resolveCodexConfigPath } from "./codex-config.js";
import { validateCodexPlugin } from "../validate-codex-plugin.mjs";

const BLOCK_KEY = "platformio";

/**
 * Renders the canonical TOML block for our MCP server entry. Uses `npx.cmd` on
 * Windows for the same reason as `_shared.js`: some hosts cannot resolve a
 * bare `npx` on Windows without the extension.
 *
 * @returns {string} TOML text terminated with a single trailing newline.
 */
function renderTomlBlock() {
  const launch = mcpServerConfigBlock();
  return [
    `[mcp_servers.${BLOCK_KEY}]`,
    `command = ${JSON.stringify(launch.command)}`,
    `args = ${JSON.stringify(launch.args)}`,
    "",
  ].join("\n");
}

/**
 * Validates before writing; malformed files remain untouched.
 * @param {string} configPath Absolute TOML destination.
 * @returns {{ path: string, action: "created" | "updated" }} Installation result.
 */
function mergeCodexConfig(configPath) {
  let existing;
  try {
    existing = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const next =
    existing === undefined ? renderTomlBlock() : mergeCodexToml(existing);
  if (existing !== next) {
    // Replace atomically in the same directory; resolve links so their target is updated.
    const destination =
      existing === undefined ? configPath : fs.realpathSync(configPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    const mode =
      existing === undefined ? 0o600 : fs.statSync(destination).mode & 0o777;
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, "wx", mode);
      fs.writeFileSync(descriptor, next, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      // Refuse to overwrite an edit made since we read the original document.
      if (
        existing === undefined
          ? fs.existsSync(destination)
          : fs.readFileSync(destination, "utf8") !== existing
      ) {
        throw new Error(
          "Codex configuration changed during installation. Retry using the updated file.",
        );
      }
      fs.renameSync(temporary, destination);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  return {
    path: configPath,
    action: existing === undefined ? "created" : "updated",
  };
}

/** Installs the launch entry without changing host permissions. */
export async function installCodex() {
  const r = mergeCodexConfig(resolveCodexConfigPath());
  console.log(`Codex CLI config ${r.action} at: ${r.path}`);
  console.log(
    "Next: restart Codex and check that the platformio server is listed. Host permissions remain controlled by Codex.",
  );
}

/**
 * Runs one Codex plugin command without a shell.
 *
 * @param {string[]} args Exact CLI arguments.
 * @param {{ platform?: string, spawnCommand?: typeof spawnSync }} [options] Execution seams for tests.
 * @returns {string} Standard output.
 */
function runCodexPluginCommand(args, options = {}) {
  const platform = options.platform ?? process.platform;
  const command = platform === "win32" ? "codex.exe" : "codex";
  const execute = options.spawnCommand ?? spawnSync;
  const result = execute(command, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || "Codex plugin command failed.").trim(),
    );
  }
  return result.stdout.trim();
}

/** Returns every string nested in a JSON-compatible value. */
function collectStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, output);
  }
  return output;
}

/** Tests structured CLI JSON output for one exact normalized value. */
function jsonOutputContains(output, expected, normalizePath = false) {
  try {
    const normalize = (value) =>
      normalizePath
        ? value.replaceAll("\\", "/").replace(/\/$/u, "").toLowerCase()
        : value;
    const normalizedExpected = normalize(expected);
    return collectStrings(JSON.parse(output)).some(
      (value) => normalize(value) === normalizedExpected,
    );
  } catch {
    return false;
  }
}

/**
 * Installs the repo-local Codex plugin and marketplace additively.
 * The legacy MCP-only config installer remains available as `--codex`.
 *
 * @param {{ packageRoot?: string, runCommand?: (args: string[]) => string, validatePlugin?: (options: { requireRuntime: boolean, repoRoot: string }) => unknown }} [options]
 * @returns {Promise<{ marketplaceAdded: boolean, pluginAdded: boolean, packageRoot: string }>} Installation summary.
 */
export async function installCodexPlugin(options = {}) {
  const packageRoot = path.resolve(
    options.packageRoot ??
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
  );
  const marketplacePath = path.join(
    packageRoot,
    ".agents",
    "plugins",
    "marketplace.json",
  );
  const pluginPath = path.join(packageRoot, "plugins", "platformio-mcp");
  if (!fs.existsSync(marketplacePath) || !fs.existsSync(pluginPath)) {
    throw new Error(
      `Codex plugin assets are missing from package root: ${packageRoot}`,
    );
  }

  const validatePlugin = options.validatePlugin ?? validateCodexPlugin;
  validatePlugin({ requireRuntime: true, repoRoot: packageRoot });

  const runCommand = options.runCommand ?? runCodexPluginCommand;
  const marketplaces = runCommand(["plugin", "marketplace", "list", "--json"]);
  const marketplaceAdded = !jsonOutputContains(marketplaces, packageRoot, true);
  if (marketplaceAdded) {
    runCommand(["plugin", "marketplace", "add", packageRoot, "--json"]);
  }

  const plugins = runCommand(["plugin", "list", "--json"]);
  const pluginAdded = !jsonOutputContains(plugins, "platformio-mcp");
  if (pluginAdded) {
    runCommand(["plugin", "add", "platformio-mcp@platformio-mcp", "--json"]);
  }

  console.log(
    pluginAdded
      ? "✅ PIO Agent Codex Plugin installed."
      : "✅ PIO Agent Codex Plugin is already installed.",
  );
  console.log(
    "Next: start a new Codex task so the plugin skills and MCP tools are loaded.",
  );
  return { marketplaceAdded, pluginAdded, packageRoot };
}

// Exported for unit testing.
export {
  findBlockRange,
  renderTomlBlock,
  mergeCodexConfig,
  runCodexPluginCommand,
  jsonOutputContains,
};
