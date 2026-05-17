---
name: esp32-flash-monitor
description: Run the common ESP32 workflow in PlatformIO: build, flash, monitor, diagnose, patch, and retry. Use for ESP32/ESP8266/ESP32-S3/ESP32-C3 projects using Arduino or ESP-IDF.
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

1. List connected devices.
2. Identify likely ESP32 serial port.
3. Confirm or infer PlatformIO board ID.
4. Build the project.
5. Summarize build result, including RAM and flash usage if available.
6. Ask user approval before flashing.
7. Upload firmware.
8. Start serial monitor.
9. Watch for boot success or crash output.
10. Diagnose and suggest next change.

## Common Board IDs

```text
esp32dev
esp32-s3-devkitc-1
esp32-c3-devkitm-1
nodemcu-32s
lolin_s2_mini
```
