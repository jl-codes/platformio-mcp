#!/usr/bin/env node

/**
 * Antigravity MCP Integration Script
 * Safely writes the current repository's compiled platformio build node target
 * into the global `~/.gemini/antigravity/mcp_config.json` configuration layer.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure paths are handled recursively
const configPath = path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json');
const repoRoot = path.resolve(__dirname, '..');
const binaryPath = path.join(repoRoot, 'build', 'index.js');
const nodeExecPath = process.execPath; // Binds explicitly to the current active NVM Node layer.

console.log('----------------------------------------------------');
console.log(' PlatformIO MCP -> Antigravity Bridging Utility');
console.log('----------------------------------------------------');

if (!fs.existsSync(binaryPath)) {
  console.error(`[FATAL] Missing compiled binary at: ${binaryPath}`);
  console.error(`>> Please compile the server using 'npm run build' before linking.`);
  process.exit(1);
}

// Scaffold target directory if it doesn't gracefully exist
const configDir = path.dirname(configPath);
if (!fs.existsSync(configDir)) {
  console.log(`[INFO] Generating nested configuration envelope for ${configDir}...`);
  fs.mkdirSync(configDir, { recursive: true });
}

let config = { mcpServers: {} };

if (fs.existsSync(configPath)) {
  try {
    const rawData = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(rawData);
    console.log(`[INFO] Mutating existing configurations found at ${configPath}.`);
  } catch (e) {
    console.warn(`[WARN] Legacy config file could not be cleanly parsed. Overwriting cleanly.`);
  }
}

if (!config.mcpServers) {
  config.mcpServers = {};
}

// Formulate the executable boundary using an Interactive Shell Wrapper `zsh -lic`
// This magically inherits ~/.zshrc dynamically, granting sterile GUIs native access to NVM & PIO.
config.mcpServers.platformio = {
  command: "zsh",
  args: [
    "-lic",
    `node ${binaryPath}`
  ]
};

// Push payload cleanly back onto disk
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

console.log('');
console.log(`✅ Successfully tethered the Antigravity Agent to:`);
console.log(`   Binary Tracker : ${binaryPath}`);
console.log(`   Execution Path : zsh -lic "node ..."  (Dynamic Profile Inheritance)`);
console.log('----------------------------------------------------');
