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

1. Inspect the exact `projectDir` with `get_project_context` and `get_policy_status`.
2. Use `list_devices` and `list_boards` only for discovery, then call `agent_resolve_target` with one environment and optional explicit port.
3. Stop if target resolution is ambiguous, unavailable, or lower-confidence than the user accepts.
4. Initialize the project only when requested, then add a minimal serial boot marker such as `BOOT_OK`.
5. Call `agent_validate_project`, then `agent_build_diagnose` for the resolved environment.
6. If the build succeeds, request explicit approval for `agent_flash_monitor_verify` using the resolved binding.
7. After approval, flash and verify bounded runtime markers. Keep the returned task ID, log paths, and binding digest.
8. Report build, flash, monitor, and assertion outcomes separately with one next action.

## Preferred Commands

Use the PlatformIO MCP tools directly. Do not substitute shell commands for build, upload, lock, or monitor operations while the MCP server is available.
