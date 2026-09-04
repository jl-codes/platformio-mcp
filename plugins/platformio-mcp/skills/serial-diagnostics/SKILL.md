---
name: serial-diagnostics
description: Diagnose embedded runtime behavior through serial logs after build/upload. Use when investigating boot loops, crashes, watchdog resets, panic output, missing boot markers, peripheral initialization issues, or silent serial sessions.
---

# Serial Diagnostics

## Purpose

Use this skill when firmware builds and flashes but the device has runtime issues.

## Safety Rules

- Do not interrupt an active flash operation.
- Do not start multiple monitors on the same port.
- Do not assume silence means success.
- Preserve serial logs.

## Workflow

1. Confirm the target device and serial port.
2. Start or query the serial monitor.
3. Capture logs for a bounded time window.
4. Identify boot markers, panic traces, reset loops, or missing output.
5. Summarize runtime health.
6. Recommend the smallest next code change.
7. If needed, patch firmware and rebuild.
8. Ask before reflashing.

## Runtime Patterns

Detect:

```text
BOOT_OK
watchdog reset
brownout detector
Guru Meditation
panic
stack overflow
heap corruption
reboot loop
no serial output
sensor init failed
WiFi failed
BLE failed
```
