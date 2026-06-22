# Troubleshooting & Remediation

[← Back to README](../README.md)

## Troubleshooting

### PlatformIO not found
1. Install: `pip install platformio`
2. Verify: `pio --version`
3. Ensure `pio` or `platformio` is in your PATH

### Board not found
Board IDs are case-sensitive. List available boards with `pio boards` or search at [PlatformIO Boards](https://docs.platformio.org/en/latest/boards/).

### Upload failures
- Check that the device is connected and powered
- Try a different USB cable
- Verify the port with `list_devices`
- Reset the device
- Close other programs using the serial port

### Build errors
- Check source code for syntax errors
- Ensure required libraries are installed
- Verify `platformio.ini` configuration
- Clean and rebuild: `pio run -t clean`

## Deep Dive Reference Guides

For specific, complex hardware and OS-level issues, refer to our detailed troubleshooting documents:
- [macOS Port Conflicts Reference Document](reference/ESP32PortConflictsOnMacOS.md)
- [Setting Up ESP32 Devices for Native USB Stability](reference/SettingUpESP32Devices.md)
- [Windows Setup & Compatibility Guide](WindowsSetupGuide.md)

## Windows-Specific Issues

### Serial monitor not streaming in dashboard UI
**Symptom**: Dashboard shows stale serial data. Log file grows but UI doesn't update.
**Cause**: `fs.watch()` on Windows uses `ReadDirectoryChangesW` which is unreliable for files written by external processes (like `pio device monitor`).
**Fix**: Use a version with the Windows polling fallback for serial monitor logs. See [Windows Setup Guide](WindowsSetupGuide.md#serial-monitor-streaming).

### "Maximum call stack size exceeded" when starting serial monitor
**Symptom**: `POST /api/spooler/start` returns 500 with "Maximum call stack size exceeded".
**Cause**: `getSpoolerStates()` exposes non-serializable `Timeout` and `FSWatcher` objects with circular references. Socket.IO serialization causes infinite recursion.
**Fix**: Use a version that emits serializable spooler state. See [Windows Setup Guide](WindowsSetupGuide.md#spooler-state-serialization).

### Browse folder button crashes on Windows
**Symptom**: Clicking "browse for folder" in dashboard UI returns 500 error.
**Cause**: The browse route uses `osascript` (macOS AppleScript) with no platform detection.
**Fix**: Use a version with OS-specific folder picker support or register the workspace path directly. See [Windows Setup Guide](WindowsSetupGuide.md#workspace-folder-browsing).

### Dashboard shows 400 on all commands
**Symptom**: Every command returns "Missing projectDir parameter".
**Cause**: No workspace registered. `workspaces.json` is empty.
**Fix**: Register workspace via file edit or API. See [Windows Setup Guide](WindowsSetupGuide.md#workspace-registration).

### Stale serial port lock
**Symptom**: "Port is currently locked: COM14" error.
**Cause**: Lock file persists after server crash or killed monitor process.
**Fix**:
```bash
del "%USERPROFILE%\.platformio-mcp\serial_ports\COM14.json"
taskkill /F /IM pio.exe
```

### ESP32-S3 serial output not visible
**Symptom**: Serial monitor connects but shows no data.
**Cause**: Missing `-DARDUINO_USB_CDC_ON_BOOT=1` build flag. Without it, `Serial.println()` goes to internal UART, not USB CDC.
**Fix**: Add to `platformio.ini`:
```ini
build_flags = -DARDUINO_USB_CDC_ON_BOOT=1
```

### hallRead() not available on ESP32-S3
**Symptom**: `'hallRead' was not declared in this scope` compilation error.
**Cause**: The hall sensor API is only available on the original ESP32, not the S3 variant. The Arduino core explicitly skips it (`.skip.esp32s3` in examples).
**Fix**: Use `touchRead(pin)` (GPIO 1-14) or `temperatureRead()` instead.
