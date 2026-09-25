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

1. Inspect the exact project with `pio-agent project context --project-dir <dir>` and `pio-agent policy-status --project-dir <dir>`.
2. Use `pio-agent devices` and `pio-agent boards` only for discovery, then run `pio-agent target-resolve` with one environment and optional explicit port.
3. Stop if target resolution is ambiguous, unavailable, or lower-confidence than the user accepts.
4. Initialize the project only when requested (`pio-agent init --board <id> --project-dir <dir>`), then add a minimal serial boot marker such as `BOOT_OK`.
5. Run `pio-agent agent-validate --project-dir <dir>`, then `pio-agent agent-build-diagnose --project-dir <dir> --environment <env>` for the resolved environment.
6. If the build succeeds, request explicit approval for `pio-agent agent-flash-monitor-verify` using the resolved binding's port and environment.
7. After approval, flash and verify bounded runtime markers. Keep the returned task ID, log paths, and binding digest.
8. Report build, flash, monitor, and assertion outcomes separately with one next action.

## Preferred Commands

Use the `pio-agent` CLI for all build, upload, monitor, and port-claim
operations. Pass `--json` when you intend to parse the output. Do not
substitute raw `pio` or `platformio` shell commands: they bypass port claims,
task tracking, and log spooling. See the `pio-manager` skill for full syntax.

A non-zero exit means read BOTH streams. An operation that ran but failed (a
build with errors) puts `success: false` on **stdout**; one that could not run
(bad arguments, policy, a busy port) puts `errorType` on **stderr** with stdout
empty. Capture both (`... --json 2>&1`).
