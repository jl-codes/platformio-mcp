---
name: esp32-flash-monitor
description: "Run the common ESP32 workflow in PlatformIO: build, flash, monitor, diagnose, patch, and retry. Use for ESP32/ESP8266/ESP32-S3/ESP32-C3 projects using Arduino or ESP-IDF."
---

# ESP32 Flash and Monitor

> **Reading results:** a non-zero exit means look at BOTH streams. An operation
> that ran but failed (a build with errors) puts `success: false` on **stdout**;
> one that could not run (bad arguments, policy, a busy port) puts `errorType` on
> **stderr** with stdout empty. Capture both (`--json 2>&1`). See the
> `pio-manager` skill for the full contract.

## Purpose

Use this skill for the common ESP32 workflow: build, flash, monitor, diagnose, patch, and retry.

## Safety Rules

- Ask before flashing.
- Do not erase flash unless explicitly requested.
- Stop active serial monitors before upload if the port is busy.
- Save build and serial logs.

## Workflow

1. Inspect `platformio.ini`, run `pio-agent devices`, and call `pio-agent target-resolve` for one explicit ESP32 environment.
2. Confirm the resolved board, stable device fingerprint, and short-lived binding; stop on ambiguity.
3. Run `pio-agent agent-safe-pin-audit --project-dir <dir> --board <id>` for ESP32 strapping, input-only, and flash/SPI pin risks.
4. Build with `pio-agent agent-build-diagnose --project-dir <dir> --environment <env>` and preserve its task/log references.
5. Summarize build result, including RAM and flash usage if available.
6. Ask user approval before flashing.
7. Call `pio-agent agent-flash-monitor-verify --project-dir <dir> --environment <env> --port <p>` with the approved target binding and bounded `--expect-all`/`--reject-patterns` markers.
8. Allow `--start-monitor` on the flash to reattach the monitor after USB re-enumeration only when the device fingerprint still matches.
9. Use `pio-agent logs capture` or `pio-agent monitor-health` for additional bounded evidence.
10. Diagnose boot loops, watchdogs, brownouts, panic output, or missing markers and suggest the smallest next change.

## Common Board IDs

```text
esp32dev
esp32-s3-devkitc-1
esp32-c3-devkitm-1
nodemcu-32s
lolin_s2_mini
```
