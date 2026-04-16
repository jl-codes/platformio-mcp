# PlatformIO MCP Server - AI Installation Guide

This guide is designed for AI agents like Antigravity and Cline to successfully set up the PlatformIO MCP Server.

## Prerequisites Check

Before installation, verify these requirements:

### 1. Check Node.js Version

```bash
node --version
```

**Required:** Node.js >= 18.0.0

If not installed or version is too old:
- macOS: `brew install node` or download from https://nodejs.org
- Linux: Use your package manager or download from https://nodejs.org
- Windows: Download from https://nodejs.org

### 2. Check PlatformIO CLI

```bash
pio --version
```

**If not installed,** PlatformIO CLI is REQUIRED. Install it:

```bash
# Recommended: Install via pip
pip install platformio

# macOS alternative
brew install platformio

# Verify installation
pio --version
```

**Important:** The server will start even without PlatformIO installed, but all operations will fail. Users MUST have PlatformIO CLI installed for the server to function.

## Installation Steps

### Step 1: Navigate to Server Directory

```bash
cd /path/to/platformio-mcp
```

### Step 2: Install Dependencies

```bash
npm install
```

**What this does:**
- Installs @modelcontextprotocol/sdk (MCP server framework)
- Installs zod (runtime type validation)
- Installs all development dependencies
- Compiles TypeScript to JavaScript

**Expected output:** Should complete without errors and create `node_modules/` and `build/` directories.

### Step 3: Build the Server

```bash
npm run build
```

**What this does:**
- Compiles TypeScript source files to JavaScript
- Creates the `build/` directory with compiled code
- Generates type declaration files

**Expected output:** No errors. The `build/` directory should contain compiled `.js` files.

### Step 4: Verify Build

```bash
ls build/
```

**Expected files:**
- `index.js` (main server file)
- `platformio.js`
- `types.js`
- `tools/` directory
- `utils/` directory

## Testing the Installation

### Test 1: Check if Server Starts

```bash
node build/index.js
```

**Expected behavior:**
- If PlatformIO IS installed: "PlatformIO MCP Server running on stdio"
- If PlatformIO NOT installed: Warning message, then "PlatformIO MCP Server running on stdio"

Press Ctrl+C to stop.

### Test 2: Verify PlatformIO Integration

Only if PlatformIO is installed:

```bash
pio boards | head -10
```

**Expected:** List of available boards.

## Agentic Project Deployment Strategies

If you are developing an embedded C/C++ repository and want to bundle `.agents/workflows` that rely on this MCP server, you have three primary deployment architectures to ensure the tools are available to any Developer or AI Agent checking out your codebase:

### 1. The `npx` Auto-Execution Approach (Cleanest)
If this package is published to NPM (or your private registry), you do not need to install anything locally. You can simply instruct users to drop this into their global `mcp_config.json`:

```json
{
  "mcpServers": {
    "platformio": {
      "command": "npx",
      "args": ["-y", "platformio-mcp-server"]
    }
  }
}
```
*Note: The `-y` flag forces Node to automatically download, execute, and bridge the MCP background server transparently on-demand without any manual `npm install` steps.*

### 2. The Native `tools/` Submodule (Embedded Standard)
If you wish to contain the dependency exclusively within your project without relying on global registries:

1. Add this repository as a submodule: `git submodule add <url> tools/platformio-mcp`
2. Create an initialization workflow (`.agents/workflows/setup.md`) that instructs the Agent:
   *"Navigate to `tools/platformio-mcp`, run `npm install`, and `npm run build`."*
3. Update the `mcp_config.json` manually or via an installer script mapping the path absolutely:

```json
{
  "mcpServers": {
    "platformio": {
      "command": "zsh",
      "args": [
        "-lic",
        "node /absolute/path/to/your-repo/tools/platformio-mcp/build/index.js"
      ]
    }
  }
}
```

### 3. The `devDependencies` Integration
If your embedded repository incorporates a `package.json` (e.g. for React captive portals):
```bash
npm install -D github:matthewmcneill/platformio-mcp
```
This isolates the utility within your `node_modules/.bin/`, allowing seamless execution securely boxed to the repository context.

---

## Configuration for Cline

Cline requires you to explicitly add the MCP server configuration into its settings file. This is typically found via the VSCode Command Palette (`Cmd+Shift+P` -> `Cline: MCP Servers`).

### Manual Configuration
Ensure you map the absolute path correctly for your workspace:

```json
{
  "mcpServers": {
    "platformio": {
      "command": "node",
      "args": [
        "/absolute/path/to/platformio-mcp/build/index.js"
      ],
      "env": {}
    }
  }
}
```

## Configuration for Antigravity & Global IDEs

Antigravity requires you to explicitly add the MCP server configuration into its global settings file. This is typically found at `~/.gemini/antigravity/mcp_config.json` on macOS/Linux.

### Automatic Installer Script
We provide a helper Node.js script to safely map your local clone directly into Antigravity's global footprint. It will intelligently resolve your node binary path and format the JSON. (For the UI dashboard, export `PIO_MCP_UI=true` in your shell environment, or pass `--ui` if modifying the args array).
```bash
# From the root of the platformio-mcp repository:
node scripts/install-antigravity.js
```

### Manual Configuration
If manually adding, ensure you map the absolute path correctly:

```json
{
  "mcpServers": {
    "platformio": {
      "command": "zsh",
      "args": [
        "-lic",
        "node /absolute/path/to/platformio-mcp/build/index.js"
      ]
    }
  }
}
```

## Configuration for Claude Code

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) is Anthropic's official CLI for Claude with native MCP support.

### Automatic Configuration
Claude Code supports adding MCP servers directly via its CLI. You can add the PlatformIO MCP server by running:

```bash
claude mcp add platformio -- node /absolute/path/to/platformio-mcp/build/index.js
```

*Note: Ensure you replace `/absolute/path/to/...` with the exact path to your cloned repository, and restart Claude Code after adding the server.*

### Manual Configuration
Alternatively, add the server to `~/.claude/settings.json` (global) or `.claude/settings.json` (project-specific):

```json
{
  "mcpServers": {
    "platformio": {
      "command": "node",
      "args": ["/absolute/path/to/platformio-mcp/build/index.js"]
    }
  }
}
```

**Verify installation:**
```bash
# Start Claude Code - MCP tools load automatically
claude

# You can check available MCP tools with:
/mcp
```

**Usage in Claude Code:**

Once configured, interact naturally with your embedded projects:
- "Build my PlatformIO project"
- "What ESP32 boards are available?"
- "Upload firmware to my connected device"
- "Search for a JSON parsing library"

Claude Code will automatically use the appropriate MCP tools (`mcp__platformio__build_project`, etc.).

## Troubleshooting

### Issue: "Cannot find module '@modelcontextprotocol/sdk'"

**Solution:**
```bash
cd /path/to/platformio-mcp
rm -rf node_modules package-lock.json
npm install
```

### Issue: TypeScript Build Errors

**Solution:**
```bash
npm run build
```

Check for specific error messages. Common issues:
- Missing type definitions: Run `npm install`
- Syntax errors: Check the error message for file and line number

### Issue: "PlatformIO CLI not found"

**Solution:**
```bash
# Install PlatformIO
pip install platformio

# Add to PATH if needed
export PATH=$PATH:~/.platformio/penv/bin

# Verify
pio --version
```

### Issue: Permission Errors on macOS/Linux

**Solution:**
```bash
# Make build directory readable
chmod -R 755 build/

# If installing packages fails
sudo npm install -g npm@latest
```

## Validating Installation

Run these commands to verify everything works:

```bash
# 1. Check directory structure
ls -la /path/to/platformio-mcp

# 2. Verify dependencies
npm list --depth=0

# 3. Check build output
ls -la build/

# 4. Test PlatformIO CLI
pio --version

# 5. Test board listing (with PlatformIO installed)
pio boards | head -5
```

**All commands should complete without errors.**

## Quick Reinstall (If Needed)

If something goes wrong, clean reinstall:

```bash
cd /path/to/platformio-mcp
rm -rf node_modules build package-lock.json
npm install
npm run build
```

## Understanding the Server

### What It Does

The PlatformIO MCP Server provides 12 tools:

1. **list_boards** - Discover available development boards
2. **get_board_info** - Get specs for a specific board
3. **list_devices** - Find connected serial devices
4. **init_project** - Create new PlatformIO project
5. **build_project** - Compile firmware
6. **clean_project** - Remove build artifacts
7. **upload_firmware** - Flash firmware to device
8. **upload_filesystem** - Upload SPIFFS/LittleFS filesystem image from `data/` directory
9. **start_monitor** - Get serial monitor command
10. **search_libraries** - Find libraries in registry
11. **install_library** - Install libraries
12. **list_installed_libraries** - List installed libraries

### Board-Agnostic Design

The server works with **ANY** board supported by PlatformIO (1000+ boards). No hardcoded configurations needed. Users just specify the board ID (e.g., "esp32dev", "uno", "nucleo_f401re").

### Example Usage Through AI Agents (Antigravity / Cline)

Once configured, users can interact naturally:

- "Show me all ESP32 boards"
- "Create a new Arduino project for board uno"
- "Build the project at /path/to/my-project"
- "Upload firmware to my connected device"
- "Search for WiFi libraries"

## Important Notes for AI Agents

1. **PlatformIO is REQUIRED**: The server wraps PlatformIO CLI. Without it, operations will fail with helpful error messages.

2. **Path handling**: All project paths are validated and normalized. The server prevents path traversal attacks.

3. **Timeouts**: 
   - Quick operations (list, search): 30 seconds
   - Builds: 10 minutes
   - Uploads: 5 minutes

4. **Error handling**: All errors include troubleshooting hints. Always show error messages to users.

5. **Board IDs are case-sensitive**: "ESP32dev" ≠ "esp32dev"

6. **Auto-detection**: Ports are auto-detected when possible. Users rarely need to specify them.

## Success Criteria

Installation is successful when:

- ✅ `npm install` completes without errors
- ✅ `npm run build` completes without errors
- ✅ `build/` directory contains compiled JavaScript
- ✅ `node build/index.js` starts the server
- ✅ PlatformIO CLI responds to `pio --version`

Once all criteria are met, the server is ready for use with Antigravity, Cline, and other AI agents!
