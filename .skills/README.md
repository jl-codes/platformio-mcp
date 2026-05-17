# PlatformIO MCP Skills

This directory contains agent-readable skills for embedded development workflows.

These skills help coding agents safely interact with firmware projects, microcontrollers, serial devices, and SBCs.

## Skills

- `firmware-bringup`: bring up a new board and verify basic firmware execution
- `platformio-debug`: diagnose PlatformIO build, dependency, and upload failures
- `serial-diagnostics`: inspect runtime logs and diagnose device behavior
- `esp32-flash-monitor`: build, flash, and monitor common ESP32 projects
- `hardware-in-the-loop-test`: validate firmware behavior on real hardware
- `sbc-deploy`: deploy and verify software on Raspberry Pi, Jetson, and similar SBCs

## Safety Principles

Agents should:

- ask before flashing firmware
- ask before destructive commands
- preserve logs
- avoid repeated blind retries
- use locks for physical devices
- summarize failures clearly
- prefer minimal patches
- keep humans informed when touching hardware

## Long-Term Direction

MCP is one adapter. PlatformIO is the first backend.

The larger goal is to provide a safe embedded agent runtime that lets Codex and other coding agents build, flash, monitor, test, and debug physical devices.
