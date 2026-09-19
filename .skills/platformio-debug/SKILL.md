---
name: platformio-debug
description: Diagnose and fix PlatformIO build, upload, and configuration failures. Use when resolving compiler errors, missing libraries, platformio.ini issues, memory overflows, port conflicts, permission errors, or failed uploads.
---

# PlatformIO Debug

> **Reading results:** a non-zero exit means look at BOTH streams. An operation
> that ran but failed (a build with errors) puts `success: false` on **stdout**;
> one that could not run (bad arguments, policy, a busy port) puts `errorType` on
> **stderr** with stdout empty. Capture both (`--json 2>&1`). See the
> `pio-manager` skill for the full contract.

## Purpose

Use this skill when a PlatformIO project fails to build, upload, or pass static checks.

## Safety Rules

- Do not hide raw error logs. Summarize them and preserve the log path.
- Do not make broad dependency changes without explaining why.
- Do not flash firmware unless the user explicitly approves.

## Workflow

1. Call `pio-agent project context --project-dir <dir>`, resolve one environment, and run `pio-agent agent-build-diagnose --project-dir <dir> --environment <env>`.
2. Use its structured diagnostics, `nextSteps`, task ID, and log paths before reading broad logs.
3. Extract the smallest redacted error snippet.
4. Identify the likely root cause.
5. Patch code, dependencies, or `platformio.ini`.
6. Rebuild with `pio-agent build --project-dir <dir> --environment <env> --json`. Retry automatically only when `safeToAutoRetry` is true and the retry remains bounded.
7. Repeat until build succeeds or a configuration, dependency, policy, approval, or hardware blocker is identified.
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
DeviceBusy
PermissionDenied
UploadFailed
Unknown
```

For upload failures, resolve the target binding again before retrying. Treat port drift as safe only when the stable device fingerprint still matches; stop on substitution or ambiguity.
