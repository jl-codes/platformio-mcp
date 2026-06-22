# Windows Setup & Compatibility Guide

[← Back to Troubleshooting](TroubleshootingGuide.md)

## Overview

This guide covers Windows-specific setup steps, known issues, and fixes for the PlatformIO MCP server and web dashboard. Most of these issues don't affect macOS or Linux users.

## Prerequisites

1. **Python 3.x** with pip: `pip install platformio`
2. **Node.js 18+**: Required for platformio-mcp
3. **PlatformIO in PATH**: Verify with `pio --version`

## Installation

```bash
git clone https://github.com/jl-codes/platformio-mcp.git
cd platformio-mcp
npm install
npm run build:ui   # builds web dashboard (web/dist/)
npx tsc            # compiles TypeScript (src/ → build/)
```

## Workspace Registration

The dashboard requires at least one workspace (project directory) to be registered. Without it, all commands return 400 "Missing projectDir parameter".

The workspace file is at `~/.platformio-mcp/workspaces.json`.

### Register via file edit (immediate)
```bash
echo [{"dir":"C:\\path\\to\\project","timestamp":1781638000000}] > "%USERPROFILE%\.platformio-mcp\workspaces.json"
```

### Register via API
```bash
curl -X POST http://localhost:8080/api/workspaces \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"dir": "C:\\path\\to\\project"}'
```

### Register via CLI (auto-registers on flash/build)
```bash
node build/cli.js flash --project-dir C:\path\to\project --port COM14 --approve
```

## Stale Lock File Handling

The spooler creates lock files in `~/.platformio-mcp/serial_ports/` (e.g., `COM14.json`). If the server crashes or a monitor process is killed, these locks become stale.

### Symptoms
- "Port is currently locked: COM14" error
- Devices show a `claim` with a dead PID

### Fix
```bash
del "%USERPROFILE%\.platformio-mcp\serial_ports\COM14.json"
taskkill /F /IM pio.exe
```

## ESP32-S3 USB CDC

The ESP32-S3 requires a specific build flag for serial output over USB:

```ini
build_flags = -DARDUINO_USB_CDC_ON_BOOT=1
```

Without this flag, `Serial.println()` output goes to the internal UART (GPIO 43/44) instead of the USB CDC port. The serial monitor will connect but show no data.

## Known Windows Compatibility Fixes

### Serial monitor streaming

**File**: `src/tools/monitor.ts`

**Problem**: `fs.watch()` on Windows uses `ReadDirectoryChangesW`, which can miss changes for log files written by external processes like `pio device monitor`. The dashboard can show stale serial data even while the log file grows.

**Fix**: PlatformIO MCP keeps the normal file watcher and adds a Windows-only polling fallback that reads newly appended log bytes every 500ms. The fallback shares the same file offset as the watcher, so duplicate serial events are avoided, and the polling interval is cleared when the monitor stops.

The same fallback is applied when active monitors are rehydrated after a server restart.

### Spooler state serialization

**File**: `src/tools/monitor.ts`

**Problem**: `getSpoolerStates()` returns the raw `activeDaemons` object which contains `watcher` (FSWatcher) and `poller` (Timeout) fields with circular references. When Socket.IO tries to serialize this for WebSocket emission via `portalEvents.emitSpoolerStates()`, the circular references cause "Maximum call stack size exceeded".

**Fix**: PlatformIO MCP returns a serializable daemon-state snapshot and strips internal `watcher` and `poller` handles before emitting spooler state to the dashboard.

### Workspace folder browsing

**File**: `src/api/server.ts`

**Problem**: `POST /api/workspaces/browse` uses `osascript` (macOS AppleScript) for the native folder picker dialog, with no platform detection. Crashes on Windows and Linux.

**Fix**: The browse route now chooses an OS-specific folder picker: AppleScript on macOS, PowerShell `FolderBrowserDialog` on Windows, and `zenity` on Linux when available. A direct `POST /api/workspaces` route is also available for registering a project path from text input when a native picker is unavailable.

## File Locations on Windows

| File | Location |
|---|---|
| Workspace registry | `%USERPROFILE%\.platformio-mcp\workspaces.json` |
| Serial port locks | `%USERPROFILE%\.platformio-mcp\serial_ports\*.json` |
| Build logs | `<project>\.pio-mcp-workspace\logs\build\` |
| Upload logs | `<project>\.pio-mcp-workspace\logs\upload\` |
| Monitor logs | `<project>\.pio-mcp-workspace\logs\monitor\` |
| Command history | `<project>\.pio-mcp-workspace\registry\command_history.json` |
