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

1. Define finite expected markers, rejected patterns, timeout, stability window, and safe physical behavior.
2. Resolve one project, environment, board, and stable device binding; stop on ambiguity or replacement.
3. Validate and build with `agent_build_diagnose`.
4. Ask for an approval scoped to the exact flash workflow and target binding.
5. Run `agent_flash_monitor_verify` after approval.
6. Check bounded serial markers, timing, or telemetry and retain task/log/artifact references.
7. Mark build, flash, monitor, and assertions independently as pass, fail, or inconclusive.
8. Cancel runaway tracked tasks with `cancel_task`; confirm cleanup with `list_task_history`, `get_monitor_status`, and lock status.
9. Save redacted evidence and summarize the result.

Scheduled HIL writes require a pre-existing, exact, expiring `lab_runner` policy. A saved prompt cannot create, approve, or broaden that policy, and default scheduled monitoring must remain read/build/monitor-only.

## Example Test Definition

```yaml
name: esp32_boot_marker
board: esp32dev
expected:
  serial_contains: BOOT_OK
  timeout_seconds: 15
```
