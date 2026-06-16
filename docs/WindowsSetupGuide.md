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

## Known Bugs and Fixes

### Bug 1: fs.watch Unreliable on Windows

**File**: `src/tools/monitor.ts`

**Problem**: `fs.watch()` on Windows uses `ReadDirectoryChangesW` which is unreliable for files being written by external processes (like `pio device monitor`). The watcher fires inconsistently or not at all, causing the dashboard serial monitor to show stale data.

**Fix**: Add a 500ms polling fallback that reads new bytes from the log file:

```typescript
// Add to DaemonContext type:
poller?: ReturnType<typeof setInterval>;

// Add after fs.watch setup in startMonitor():
daemon.poller = setInterval(() => {
  try {
    const stat = fs.statSync(logFile);
    if (stat.size > (daemon.fileOffset || 0)) {
      const buffer = Buffer.alloc(stat.size - (daemon.fileOffset || 0));
      const fd = fs.openSync(logFile, "r");
      fs.readSync(fd, buffer, 0, buffer.length, (daemon.fileOffset || 0));
      fs.closeSync(fd);
      const text = buffer.toString();
      if (text.length > 0) {
        portalEvents.emitSerialLog(activePort!, text, daemon.taskId);
      }
      daemon.fileOffset = stat.size;
    }
  } catch {}
}, 500);

// Add to stopMonitor():
if (daemon.poller) {
  clearInterval(daemon.poller);
  daemon.poller = undefined;
}
```

Apply the same polling pattern to `rehydrateMonitors()`.

### Bug 2: getSpoolerStates Serialization Crash

**File**: `src/tools/monitor.ts`

**Problem**: `getSpoolerStates()` returns the raw `activeDaemons` object which contains `watcher` (FSWatcher) and `poller` (Timeout) fields with circular references. When Socket.IO tries to serialize this for WebSocket emission via `portalEvents.emitSpoolerStates()`, the circular references cause "Maximum call stack size exceeded".

**Fix**: Strip non-serializable fields before returning:

```typescript
export function getSpoolerStates() {
  const clean: Record<string, Omit<DaemonContext, 'watcher' | 'poller'>> = {};
  for (const [port, daemon] of Object.entries(activeDaemons)) {
    const { watcher, poller, ...rest } = daemon;
    clean[port] = rest;
  }
  return clean;
}
```

### Bug 3: Browse Route macOS-Only

**File**: `src/api/server.ts`

**Problem**: `POST /api/workspaces/browse` uses `osascript` (macOS AppleScript) for the native folder picker dialog, with no platform detection. Crashes on Windows and Linux.

**Fix**: Add platform detection:

```typescript
if (process.platform === "darwin") {
  result = execSync("osascript -e 'POSIX path of (choose folder)'").toString().trim();
} else if (process.platform === "win32") {
  const ps = `[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select PlatformIO Project'; $f.ShowNewFolderButton = $false; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath } else { '' }`;
  result = execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 60000 }).toString().trim();
} else {
  try {
    result = execSync("zenity --file-selection --directory --title='Select PlatformIO Project'", { timeout: 60000 }).toString().trim();
  } catch {
    res.status(400).json({ error: "Native folder picker not available. Use text input." });
    return;
  }
}
```

Also add a `POST /api/workspaces` route for direct path registration (text input fallback).

## File Locations on Windows

| File | Location |
|---|---|
| Workspace registry | `%USERPROFILE%\.platformio-mcp\workspaces.json` |
| Serial port locks | `%USERPROFILE%\.platformio-mcp\serial_ports\*.json` |
| Build logs | `<project>\.pio-mcp-workspace\logs\build\` |
| Upload logs | `<project>\.pio-mcp-workspace\logs\upload\` |
| Monitor logs | `<project>\.pio-mcp-workspace\logs\monitor\` |
| Command history | `<project>\.pio-mcp-workspace\registry\command_history.json` |
