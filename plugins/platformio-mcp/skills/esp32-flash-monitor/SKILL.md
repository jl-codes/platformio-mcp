---
name: esp32-flash-monitor
description: "Run the common ESP32 workflow in PlatformIO: build, flash, monitor, diagnose, patch, and retry. Use for ESP32/ESP8266/ESP32-S3/ESP32-C3 projects using Arduino or ESP-IDF."
---

# ESP32 Flash and Monitor

## Purpose

Use this skill for the common ESP32 workflow: build, flash, monitor, diagnose, patch, and retry.

## Safety Rules

- Ask before flashing.
- Do not erase flash unless explicitly requested.
- Stop active serial monitors before upload if the port is busy.
- Save build and serial logs.

## Workflow

1. Inspect `platformio.ini`, list devices, and call `agent_resolve_target` for one explicit ESP32 environment.
2. Confirm the resolved board, stable device fingerprint, and short-lived binding; stop on ambiguity.
3. Run `agent_safe_pin_audit` for ESP32 strapping, input-only, and flash/SPI pin risks.
4. Build with `agent_build_diagnose` and preserve its task/log references.
5. Summarize build result, including RAM and flash usage if available.
6. Ask user approval before flashing.
7. Call `agent_flash_monitor_verify` with the approved target binding and bounded expected/rejected markers.
8. Allow the server to reattach the monitor after USB re-enumeration only when the device fingerprint still matches.
9. Use `capture_serial_window` or `agent_monitor_health` for additional bounded evidence.
10. Diagnose boot loops, watchdogs, brownouts, panic output, or missing markers and suggest the smallest next change.

## Common Board IDs

```text
esp32dev
esp32-s3-devkitc-1
esp32-c3-devkitm-1
nodemcu-32s
lolin_s2_mini
```
