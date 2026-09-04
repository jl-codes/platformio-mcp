---
name: hardware-in-the-loop-test
description: Validate firmware behavior on real hardware rather than compilation-only checks. Use when running physical acceptance tests, confirming boot markers, validating sensor output, or checking runtime timing/telemetry.
---

# Hardware-in-the-Loop Test

## Purpose

Use this skill to validate firmware behavior on a real device, not just through compilation.

## Safety Rules

- Ask before flashing.
- Do not assume physical wiring is safe.
- Do not activate motors, heaters, lasers, relays, pumps, or high-power outputs without explicit user approval.
- Keep tests bounded by timeout.
- Save logs and artifacts.

## Workflow

1. Define expected behavior.
2. Build firmware.
3. Ask before flashing.
4. Flash firmware.
5. Monitor device output.
6. Check expected serial strings, timing, or telemetry.
7. Mark pass/fail.
8. Save build logs, flash logs, and serial logs.
9. Summarize results.

## Example Test Definition

```yaml
name: esp32_boot_marker
board: esp32dev
expected:
  serial_contains: BOOT_OK
  timeout_seconds: 15
```
