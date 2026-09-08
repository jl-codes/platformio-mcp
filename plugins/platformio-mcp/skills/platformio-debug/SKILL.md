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

1. Call `get_project_context`, resolve one environment, and run `agent_build_diagnose`.
2. Use its structured diagnostics, `nextSteps`, task ID, and log paths before reading broad logs.
3. Extract the smallest redacted error snippet.
4. Identify the likely root cause.
5. Patch code, dependencies, or `platformio.ini`.
6. Rebuild through MCP. Retry automatically only when `safeToAutoRetry` is true and the retry remains bounded.
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
PortBusy
PermissionDenied
UploadFailed
Unknown
```

For upload failures, resolve the target binding again before retrying. Treat port drift as safe only when the stable device fingerprint still matches; stop on substitution or ambiguity.
