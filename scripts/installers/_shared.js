/**
 * Shared utilities for PlatformIO MCP installers.
 *
 * Provides the canonical MCP server config block (npx-based, cross-platform)
 * and idempotent JSON config merging with backup/recovery for malformed files.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Returns the standard MCP server config block for platformio-mcp.
 * Uses `npx -y platformio-mcp` so users always get the latest published version.
 *
 * On Windows, npm shims live as `npx.cmd`; some hosts (Claude Desktop on Windows)
 * cannot resolve a bare `npx` without the extension, so we explicitly emit the
 * platform-correct command name.
 *
 * @returns {{ command: string, args: string[] }}
 */
export function mcpServerConfigBlock() {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  return {
    command,
    args: ["-y", "platformio-mcp", "--open-dashboard-on-start"],
  };
}

/**
 * Idempotently merges an `mcpServers.<blockKey>` entry into a JSON config file,
 * creating any missing parent directories. If the existing file cannot be parsed
 * as JSON, it is backed up to `<file>.bak` and rewritten cleanly.
 *
 * @param {string} configPath Absolute path to the JSON config file.
 * @param {string} [blockKey="platformio"] Server identifier under mcpServers.
 * @returns {{ path: string, action: "created" | "updated" }}
 */
export function mergeMcpConfig(configPath, blockKey = "platformio") {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let config = { mcpServers: {} };
  let action = "created";

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      config = JSON.parse(raw);
      action = "updated";
    } catch (e) {
      console.warn(
        `[WARN] Existing config at ${configPath} is not valid JSON; backing up to .bak and rewriting.`,
      );
      fs.copyFileSync(configPath, `${configPath}.bak`);
      config = { mcpServers: {} };
    }
  }

  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }
  config.mcpServers[blockKey] = mcpServerConfigBlock();

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return { path: configPath, action };
}

/**
 * Returns the OS-specific roaming/app-data directory.
 *   macOS:   ~/Library/Application Support
 *   Windows: %APPDATA% (or ~/AppData/Roaming as fallback)
 *   Linux:   ~/.config
 *
 * @returns {string}
 */
export function appDataDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }
  if (process.platform === "win32") {
    return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  }
  return path.join(os.homedir(), ".config");
}
