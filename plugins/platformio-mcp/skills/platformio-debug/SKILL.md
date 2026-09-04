---
name: platformio-debug
description: Diagnose and fix PlatformIO build, upload, and configuration failures. Use when resolving compiler errors, missing libraries, platformio.ini issues, memory overflows, port conflicts, permission errors, or failed uploads.
---

# PlatformIO Debug

## Purpose

Use this skill when a PlatformIO project fails to build, upload, or pass static checks.

## Safety Rules

- Do not hide raw error logs. Summarize them and preserve the log path.
- Do not make broad dependency changes without explaining why.
- Do not flash firmware unless the user explicitly approves.

## Workflow

1. Run or inspect the build.
2. Classify the failure.
3. Extract the smallest useful error snippet.
4. Identify the likely root cause.
5. Patch code, dependencies, or `platformio.ini`.
6. Rebuild.
7. Repeat until build succeeds or a blocker is identified.
8. Summarize the exact fix.

## Error Types

Classify failures as one of:

```text
MissingHeader
MissingLibrary
WrongBoard
WrongFramework
SyntaxError
LinkerError
MemoryOverflow
PortBusy
PermissionDenied
UploadFailed
Unknown
```
