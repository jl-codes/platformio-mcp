---
name: firmware-bringup
description: Bring up a new embedded board or create a minimal working firmware project with PlatformIO. Use when setting up a new project, identifying a connected board, creating a blink or serial smoke test, verifying build/flash/boot, or confirming the board is alive.
---

# Firmware Bringup

## Purpose

Use this skill when the user wants to bring up a new embedded board or create a minimal working firmware project.

## Safety Rules

- Do not flash firmware without explicit user approval.
- Do not erase flash unless the user explicitly asks.
- Do not assume the serial port. Discover connected devices first.
- Preserve logs and task IDs for debugging.

## Workflow

1. List connected devices.
2. Search for the likely PlatformIO board ID.
3. Initialize or inspect the project.
4. Add a minimal boot marker, such as `BOOT_OK`, to serial output.
5. Build the project.
6. If build succeeds, ask the user before flashing.
7. Flash the firmware after approval.
8. Start serial monitoring.
9. Verify expected boot output.
10. Summarize result and next steps.

## Preferred Commands

Use available repo tools or CLI commands equivalent to:

```bash
pio-mcp devices
pio-mcp boards search esp32
pio-mcp init --board esp32dev --framework arduino
pio-mcp build
pio-mcp flash --port auto
pio-mcp monitor --timeout 30
```
