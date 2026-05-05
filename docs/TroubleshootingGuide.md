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
