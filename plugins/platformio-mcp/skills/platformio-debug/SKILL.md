---
name: platformio-debug
description: Diagnose and fix PlatformIO build, upload, and configuration failures. Use when resolving compiler errors, missing libraries, platformio.ini issues, memory overflows, port conflicts, permission errors, failed uploads, crash backtraces, or firmware size analysis.
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

## Dependency audit

Use `deps_check` with `projectDir` and an optional `environment` to inspect
declarations and installed library manifests. `build` defaults to false. An
explicit `build: true` requires separate build permission and returns LDF graph
evidence. Inspect `inventoryComplete`, diagnostics, and graph status before
claiming the audit is clean. Name collisions and leftover-library findings do
not prove which library was linked. Scoped approvals are separate for the
overall request, configuration, inventory and optional build stages.

## Crash and size analysis

Use `decode_backtrace` with `projectDir`, `environment`, and the captured `text`.
Keep `includeAllHex` false unless the trace format requires it; arbitrary hex
values need not be code addresses. Supply `expectedElfSha256` when the matching
firmware identity is known, or `archivedElfSha256` for an available retained ELF.
Keep unresolved frames explicit. Decoding against an ELF does not prove that ELF
matches the firmware currently running on the board.

Use `size_report` with `projectDir`, `environment`, and optionally `top` or
`filter` to locate large symbols and sections. These operations may execute
PlatformIO build metadata collection and require its permission even when no
hardware is contacted. Static symbol sizes do not measure runtime heap/stack
use; inspect accounting and partition evidence before diagnosing flash overflow.
The dashboard command feed shows a bounded preview; use the tool result for the
full returned analysis.

## Permission failures

Call `get_policy_status` for the same `projectDir`. Inspect `valid`, `source`,
`sources`, `projectEnrollment`, and the allowed/approval-required/denied lists.
An invalid policy is a configuration error, not permission to fall back to a more
permissive profile. Follow the reported source and error to correct it within the
user's authorized scope, then read status again.

`serverPolicy` describes this server's gates. `hostPolicy` reports external host
enforcement with unknown effective runtime permissions. Do not interpret a server
allow as approval from Codex or another MCP host, or edit host `config.toml` to
bypass a denial. Preserve customized host tool settings during installation.
