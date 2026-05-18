# Codex Usage Guide

## What This Enables for Codex

PlatformIO MCP provides a Codex-facing hardware execution layer for embedded work:

- inspect firmware projects and PlatformIO config
- discover boards and connected devices
- build firmware and collect structured diagnostics
- flash firmware only after explicit approval
- monitor serial output and preserve logs
- run hardware-in-the-loop validation with bounded checks

MCP is one adapter. PlatformIO is the first backend.

## Why Embedded Development Needs a Physical Feedback Loop

Embedded code quality depends on physical behavior, not just compilation. A safe loop is:

1. inspect project state
2. build and review diagnostics
3. request approval before hardware-touching steps
4. flash and monitor
5. summarize observed runtime behavior

Without this loop, agents can miss boot loops, serial issues, timing faults, and board-specific runtime errors.

## Recommended Codex Workflow

1. Inspect `platformio.ini`, source files, and prior logs.
2. Discover connected devices and candidate board IDs.
3. Build firmware and summarize results.
4. Ask for approval before flashing.
5. Flash after approval.
6. Monitor serial output with a timeout and expected markers.
7. Summarize pass/fail and next smallest change.

## Safety Rules

- Do not flash firmware without explicit human approval.
- Do not erase flash without explicit human approval.
- Do not run arbitrary shell commands without approval.
- Preserve logs and artifacts for review.
- Summarize failures before retrying.
- Ask before changing board config, upload ports, or platform versions.

## Example Session

1. `devices --json`
2. `boards --filter esp32 --json`
3. `build --project-dir ./firmware --json`
4. Ask user: "Build succeeded. Approve flash?"
5. `flash --project-dir ./firmware --port auto --json` (after approval)
6. `monitor --project-dir ./firmware --port auto --expect BOOT_OK --timeout 30 --json`
7. Summarize runtime result and propose minimal next step.

## Good Codex Behavior

- prefer small, reversible code changes
- explain why each build/flash/monitor step is needed
- keep hardware actions explicit and auditable
- provide concise summaries with log locations
- avoid blind retries; adapt from diagnostics

## Failure Handling

When a step fails:

1. report stage and error type
2. include the smallest useful log excerpt
3. provide one likely root cause
4. propose one safe next action
5. ask approval again before repeating hardware-touching operations

## Recommended Use Cases

- board bring-up for ESP32/ESP8266/STM32/RP2040
- PlatformIO build and dependency debugging
- upload and serial verification workflows
- BOOT_OK marker validation
- hardware-in-the-loop acceptance checks
- memory and config regression checks

## Long-Term Direction

Treat this project as a protocol-neutral embedded agent runtime:

- MCP remains supported as an adapter
- PlatformIO is the first execution backend
- additional adapters/backends can share the same safety and observability model
