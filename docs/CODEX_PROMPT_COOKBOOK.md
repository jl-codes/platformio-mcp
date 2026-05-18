# Codex Prompt Cookbook

Use these prompts as copy-paste starters. Each prompt includes a safety reminder.

## Bring Up a New ESP32 Project

```text
Set up a new PlatformIO Arduino project at ./firmware for board esp32dev.
Discover devices, confirm board choice, add a minimal BOOT_OK serial marker, and build.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Inspect an Existing Firmware Project

```text
Inspect this PlatformIO project at ./firmware: summarize platformio.ini environments, source layout, and likely runtime entry points.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Build Firmware

```text
Build the project at ./firmware and summarize success/failure, key diagnostics, and memory usage.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Flash Firmware With Approval

```text
Prepare to flash ./firmware on port auto. First summarize build status and ask me for explicit approval before upload.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Flash and Monitor

```text
After I approve flashing, upload firmware from ./firmware and monitor serial output for 30 seconds expecting BOOT_OK.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Diagnose Build Failure

```text
Diagnose the latest build failure in ./firmware. Classify the error type, provide the smallest useful snippet, and propose the minimal fix.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Fix Missing Library

```text
Resolve missing library errors in ./firmware by proposing the smallest platformio.ini or source change, then rebuild and summarize outcome.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Diagnose Upload Failure

```text
Diagnose why upload failed for ./firmware. Check likely port/permission/lock causes and provide one safe retry plan.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Diagnose Serial Boot Loop

```text
Analyze serial logs for boot loops, reset causes, or panic traces, then recommend the smallest code/config change.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Add a BOOT_OK Marker

```text
Add a BOOT_OK serial boot marker to the main firmware entry path in ./firmware and explain exactly where it was added.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Hardware-in-the-Loop Validation

```text
Run a hardware-in-the-loop validation plan for ./firmware: define expected serial behavior, bounded timeout checks, and pass/fail criteria.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Memory Usage Review

```text
Review the latest build memory usage for ./firmware (RAM/flash). Flag risk levels and suggest minimal optimizations.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## PlatformIO Config Review

```text
Review platformio.ini for ./firmware and suggest safe improvements to environments, library declarations, and upload settings.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Serial Log Summary

```text
Summarize the latest serial logs into: boot status, warnings/errors, probable root cause, and one next action.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Safe Refactor

```text
Refactor firmware code in ./firmware for readability while preserving behavior. Keep changes minimal and summarize risk.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Add Sensor Readout

```text
Add a periodic sensor readout path in ./firmware with clear serial output formatting and basic failure handling.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Debug Runtime Behavior

```text
Debug runtime behavior for ./firmware using build diagnostics plus serial observations; propose smallest fix and validation steps.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Prepare Pull Request Summary

```text
Prepare a PR summary for current firmware changes: problem, fix, validation evidence, and residual risks.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Generate Test Plan

```text
Generate a firmware test plan for ./firmware covering build checks, upload gating, serial markers, and regression coverage.
Do not flash or perform any hardware-touching action without my explicit approval.
```

## Agent Safety Reminder

```text
Before any hardware workflow, restate safety constraints: approval before flash/erase, preserve logs, and summarize failures before retrying.
Do not flash or perform any hardware-touching action without my explicit approval.
```
