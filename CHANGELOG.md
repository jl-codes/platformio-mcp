# Changelog

All notable changes to **platformio-mcp** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - Unreleased

### Added

- **The CLI is the primary interface.** `pio-agent` (also `platformio-mcp`) is a
  complete standalone adapter; nothing starts a long-lived process unless asked.
  MCP is unchanged and fully supported, now behind an explicit `pio-agent serve`.
  Bare invocation still starts the MCP server but prints a deprecation warning
  on stderr; the installers generate the `serve` form.
- Skills retargeted from MCP tool names to CLI commands. `pio-manager` is the
  gateway skill: Tier 1 is the `pio-agent` CLI, MCP is Tier 2 only when a
  server is already running, and it documents the stdout/stderr/exit-code
  contract (three outcomes, not two) and the `PortBusy` / `DeviceBusy`
  distinction. The dashboard skill never starts the dashboard itself; it tells
  the user to run `pio-agent dashboard --serve`. README and the LLM
  installation guide lead with the CLI; MCP is documented as optional.
- CLI commands closing the gap with the MCP tools: `lib`, `project`, `logs`,
  `board-info`, `system-info`, `monitor-stop`, `task-cancel`, `upload-fs`,
  `lock status`, `port release --port <p> [--force]` (the claim errors point
  users at the last two for recovery), plus `serve` and `dashboard --serve`.
- `install_library` / `lib install` accept PlatformIO's canonical `owner/name`
  identifier (`bblanchon/ArduinoJson`), and `validateSerialPort` accepts
  `/dev/serial/by-id/...`, `/dev/serial/by-path/...` and `/dev/ttyAMA0`.
- Optional `platformio-mcp-python` compatibility mode registers all 40 pinned
  reference tool names alongside 72 normal-mode tools. Registration is not a
  declaration of completed behavioral or physical acceptance.
- Connection-owned serial sessions, bounded capture, memory telemetry and port
  diagnosis without compatibility mode, preserving legacy monitor tools.
- Retained-artifact flash verification with connection-local approval/resume;
  ESP firmware/filesystem OTA with pinned destinations, bounded optional ICMP
  checks, and a shared `upload-ota` CLI command.
- Classified debugger operations, ELF/partition/core-dump inspection, and serial
  or PPK2 power profiling with explicit device and electrical authorization.
- Functional candidate packaging across npm, Python and GHCR, including all seven
  requested scoped npm name families. Candidates remain unpublished until their
  authority, naming eligibility and release gates are satisfied.
- Source-bound acceptance evidence collection and installer evidence production.

### Changed

- **`pio-agent dashboard` no longer boots the dashboard on demand.** It reports
  whether one is running in any process and its URL; `pio-agent dashboard
  --serve` starts it and prints the single-use launch URL (`--operator` mints
  an operator session for that browser). Scripts that relied on the auto-boot
  must pass `--serve`.
- `--background` on the CLI now genuinely returns immediately: the command
  re-executes itself detached with a preassigned task id, and
  `task-status <id>` reads the result. Previously it printed `running` and then
  blocked for the whole task.
- Commands that ran but failed (`build` with compiler errors, `test`) exit
  non-zero; queries that answer "no" (`task-cancel` on a finished task,
  `monitor-health` with nothing to assert) still exit 0.
- `--version` is a global flag only when it leads, so `lib install <name>
  --version 1.2.3` installs that version instead of printing the CLI version.
  `--help` works after any command. An unknown leading flag is an error rather
  than starting the MCP server.
- **Diagnostics: the log-matcher `errorType: "PortBusy"` is renamed
  `"DeviceBusy"`** (the OS reporting the device busy, often transient, still
  `safeToAutoRetry: true`). `"PortBusy"` now means another pio-agent process
  holds a claim on the port and is `safeToAutoRetry: false`. This `diagnostic`
  object ships inside MCP `upload_firmware` / `upload_filesystem` results, so
  consumers matching the old string must update.
- Resolve server policy and host configuration provenance without treating
  `config.toml` settings as blanket server authorization. Preserve existing Codex
  comments, restrictions, custom launchers and policy selectors during installation.
- Pin every npm wrapper to the exact canonical release version and keep package
  eligibility, publisher control, publication and installed verification separate.

### Fixed

- **Two processes could flash the same board.** The per-port claim was not a
  lock: `claimPort` overwrote any existing claim unconditionally and the flash
  paths never checked it. Claims are now published atomically (temp file plus
  `link()`, which never exposes a partial file), stale claims are reclaimed
  under a breaker, releases are owner-checked, and a monitor claim tracks the
  detached monitor child rather than the process that launched it. Two TTLs
  apply -- 30 min for uploads (`PIO_PORT_CLAIM_TTL_MS`), 24 h for monitors
  (`PIO_MONITOR_CLAIM_TTL_MS`) -- so a live monitor is never reclaimed by a
  flash-sized timer, yet a recycled PID cannot wedge a port forever.
- `stopMonitor` force-cleared a claim on a kill it never verified; it now
  requires the identity-verified kill to succeed, and says on stderr whose
  monitor it is stopping when that monitor belongs to another session.
- `pio-agent monitor` printed its result and then never exited (an un-unref'd
  log watcher; on Windows, also the polling fallback).
- On Windows, a claim for `COM1`-`COM9` would have been written to the serial
  device itself (reserved DOS device names); those filenames are now prefixed.
- `reset_server_state` skipped `.reclaim` breakers and `.tmp.` files, so it
  reported "all locks cleared" while leaving a wedged port behind.
- Advertise retained flash resume and approval fields in MCP schemas.
- Expose owned serial, retained flash and OTA capabilities in normal mode.
- Return bounded schema-validation errors instead of internal errors for invalid
  compatibility arguments; redact OTA credentials from build diagnostics.

### Release status

3.1.0 is prepared but not published. Native wheel installation on five hosts and
amd64/arm64 container builds passed on the recorded pre-release source. Full parity,
required physical acceptance, publisher setup and registry-installed verification
remain incomplete. See [distribution readiness](docs/DISTRIBUTION_READINESS.md)
and the [compatibility guide](docs/package-compatibility.md) for current limits.

## [3.0.0] - 2026-09-08

### Added

- **PIO Agent Codex Plugin** shipped directly from the main repository, with a
  repo-local marketplace entry, eight workflow skills, a bundled 42-tool MCP
  runtime, and cache-portable installation.
- **Codex-native dashboard workflow** that opens the authenticated PlatformIO
  control plane in Codex's browser panel while retaining complete headless CLI
  and MCP fallbacks.
- **Agent-grade embedded workflows** for target resolution, background builds,
  approval-bound flashing, serial monitoring, runtime assertions, diagnostics,
  cancellation, locking, and bounded hardware-in-the-loop evidence.
- **Monitoring automation support** for build health, device presence, serial
  health, and bounded lab checks with quiet healthy-state behavior.
- **PIO Agent branding and CLI alias** while preserving `platformio-mcp` as the
  stable npm package, executable, MCP server, and Codex plugin identifier.
- **Installable npm compatibility names** for `pio-mcp` and `pio-agent`, both
  delegating to the canonical `platformio-mcp` CLI implementation.

### Changed

- Promoted the package and plugin to **3.0.0** to reflect the new integrated
  product surface and release contract.
- Hardened the release workflow with the Codex narrow-panel Chromium journey,
  exact tag/version validation, npm tarball inspection, and token-free npm OIDC
  publishing support.
- Restricted npm package inputs to immutable runtime, plugin, dashboard, and
  installer assets so local logs and workspace state cannot enter a release.
- Updated the `pio-mcp` compatibility package to depend on `platformio-mcp`
  3.x and use the PIO Agent product name.

### Fixed

- Allowed long dashboard card titles to wrap at the 320-pixel minimum Codex
  panel width instead of being clipped by Ant Design's default no-wrap rule.

### Security

- Kept the authenticated loopback dashboard, approval-bound hardware writes,
  redacted evidence, and deterministic bundled-runtime validation as mandatory
  release gates.
- Rejected mutable server state, audit logs, credential files, high-confidence
  token signatures, and browser-test artifacts from npm package manifests.

## [2.2.2] - 2026-05-18

### Added

- **Diagnostics Engine v1 scaffolding and classifiers** under
  `src/core/diagnostics/`:
  - `types.ts` (`DiagnosticStage`, `DiagnosticErrorType`, `DiagnosticResult`)
  - `matchers.ts` (build/upload/serial regex matcher sets)
  - `diagnose.ts` (shared classifier pipeline)
  - stage-specific wrappers (`build-diagnostics.ts`,
    `upload-diagnostics.ts`, `serial-diagnostics.ts`)
- **Safety & Policy Engine v1** under `src/core/policy/`:
  - typed policy/approval/audit models
  - default risk map + policy defaults
  - policy loader (global + workspace overrides)
  - policy evaluator (`allow` / `deny` / `requires_approval`)
  - approval registry, audit JSONL appender, and secret redaction
- **Dashboard safety visibility**:
  - `GET /api/safety/overview` route aggregating pending approvals,
    recent audit events, device lock state, recent diagnostics, and raw log links
  - new UI panel `web/src/components/safety-policy-overview.tsx`
    rendered in project info view.

### Changed

- **CLI adapter (`pio-agent` / `platformio-mcp`) now enforces policy decisions**
  before command execution, including:
  - interactive approval prompt for risky actions
  - `--approve` override for explicit non-interactive confirmation
  - structured policy errors in JSON mode.
- **Approval lifecycle management is now first-class in CLI + dashboard UI**:
  - CLI commands: `approvals`, `approve <approval-id>`, `deny <approval-id>`
  - Dashboard API routes:
    `GET /api/safety/approvals`,
    `POST /api/safety/approvals/:id/approve`,
    `POST /api/safety/approvals/:id/deny`
  - Safety panel controls to approve/deny pending requests in-place.
- **MCP tool dispatch now performs pre-execution policy evaluation** and returns
  structured `policyDecision` payloads when actions are denied or require approval.
- **Build/upload/monitor outputs now include safer diagnostics context**:
  - redacted output paths for returned logs
  - structured `diagnostic` objects on build/upload/task-status responses
  - preserved raw log references for forensic review.
- **Server data path handling hardened**:
  - `SERVER_DATA_DIR` now resolves via writable fallback chain
    (`PIO_MCP_DATA_DIR` -> home -> cwd -> temp) to avoid host-permission
    failures in constrained environments.

### Fixed

- Resolved multiple environment-permission regressions caused by hard
  writes to `~/.platformio-mcp` by routing policy/audit/approval stores
  through the unified writable server data directory.

### Tests

- Added diagnostics/policy focused tests:
  - `tests/diagnostics-engine.test.ts`
  - `tests/policy-engine.test.ts`
- Updated existing suites for policy/approval-aware behavior and constrained-host
  execution semantics.
- Validation completed:
  - `npx tsc --noEmit`
  - `npm run build`
  - `npm run test`
  - `web: npm run test -- --run`
  - `npm run smoke-test`

### Notes

- Full MCP stdio E2E (`tests/mcp.test.ts`) remains gated behind
  `RUN_MCP_E2E=1` due to host/runtime transport dependence; non-E2E suites
  and build/smoke checks are green.

## [2.2.1] — 2026-05-14

### Fixed

- **Repeated browser tabs from `getDashboardStatus`** — Every invocation of
  `getDashboardStatus(autoOpen=true)` unconditionally called `open(secureLink)`,
  with no record of whether the tab had already been spawned. The result, in
  hosts running multiple MCP clients (e.g. several Cline profiles) or any
  workflow that re-invokes the `get_dashboard_url` tool, was a continuous
  flood of new browser windows pointed at `http://localhost:<port>?token=…`.
  The port itself crept upward (8080 → 8081 → 8082 → …) as concurrent MCP
  instances each fell forward through the `EADDRINUSE` retry loop, making the
  symptom worse over time.

  The fix is idempotent-by-construction: `activePortalStatus` now carries a
  `browserOpened` latch that is set on the first successful `open()` call and
  blocks every subsequent attempt for the remainder of the process lifetime.
  Auto-open is now also explicitly skippable via either the
  `PIO_MCP_NO_BROWSER=true` environment variable or the `--no-browser` CLI
  flag, which take precedence over `--open-dashboard-on-start`. Coverage is
  locked in by `tests/dashboard-open.test.ts`, which asserts that five
  back-to-back `getDashboardStatus(true)` calls produce exactly one `open()`
  invocation and that both opt-out paths suppress it entirely.

### Internal

- `package-lock.json` corrected to reflect the published package identity
  (`platformio-mcp` / matching version) instead of stale pre-rename
  `platformio-mcp-server` / `1.0.0` metadata. No dependency graph changes.

## [2.2.0] — 2026-05-11

This release is driven by analysis of **EmbedBench** agent traces. Three
patterns dominated the slow/failed runs: (1) a 4–5-tool "bootstrap ritual"
on every task pickup, (2) repeated `build_project` calls that paid the full
toolchain warmup despite no source changes, and (3) raw stderr blobs that
were hard for LLMs to act on. v2.2.0 addresses each directly.

### Added

- **`get_project_context` tool** — Single-call orientation that returns
  `{ environments, defaultEnvironment, sourceFiles, libDeps, cacheReady,
  firmwarePath, connectedDevices, lastBuild, nextSteps[] }`. Pure I/O, no
  `pio` spawns, safe to re-invoke. Replaces the typical 4–5 manual
  `read_file` / `list_files` / `list_devices` round-trips agents made on
  every pickup.

- **Content-hash build cache** (`src/utils/build-cache.ts`) —
  `build_project` now SHA-256–fingerprints `src/`, `include/`, `lib/`, and
  `platformio.ini` (plus the env name). On a hit, the call returns
  `cacheHit: true` with the cached firmware path, RAM/Flash usage, and a
  trimmed log tail, **without re-invoking the PIO toolchain**. The cache
  is:
  - Skipped when `background=true` (caller asked for async dispatch).
  - Skipped when `verbose=true` (caller asked for fresh compiler output).
  - Invalidated automatically by `clean_project`.
  - Invalidated on any failed build, preventing a confusing
    "fresh failure but stale success cached" state.
  - Stored at `<project>/.pio/.mcp-build-cache.json`.

- **Structured build errors + `nextSteps[]`** on `BuildResult` —
  `parseStructuredBuildErrors` classifies compiler/linker/PIO output into
  one of: `missing_header`, `undefined_reference`, `syntax`,
  `missing_library`, `missing_platformio_ini`, `missing_environment`,
  `permission`, `toolchain`. `deriveNextSteps` then translates the
  category set into a short, actionable hint list (e.g. "call
  `install_library` for the missing header" or "pass `--environment`
  explicitly").

### Changed

- Sharpened tool descriptions in `src/index.ts` for `build_project`,
  `upload_firmware`, `init_project`, and the new `get_project_context` so
  the canonical pre-flight order and cache semantics are explicit to LLM
  agents reading the tool catalog.

### Fixed

- **Multi-line `lib_deps` parsing** in the INI scanner. The previous regex
  truncated after the first entry because the `m`-flag `$` anchor
  terminated the lazy capture at the first end-of-line. Replaced with a
  small line-based state machine that tolerates PlatformIO's actual
  continuation conventions (indented follow-on lines, blank lines, section
  headers as terminators).

### Internal

- 21 new vitest cases:
  - `tests/build-cache.test.ts` — hash determinism, env-keyed entries,
    invalidation on edit/clean, missing-firmware staleness detection.
  - `tests/project-context.test.ts` — INI parsing, multi-env warnings,
    cache warmth detection, graceful malformed-INI handling.
  - `tests/structured-errors.test.ts` — category extraction with file/line
    metadata, `deriveNextSteps` translation.
- `BuildResult` gains optional fields: `cacheHit`, `structuredErrors`,
  `nextSteps`, `firmwarePath`. All purely additive — no breaking changes
  to consumers reading the prior shape.

### Verification

- `tsc --noEmit` clean.
- All 21 new tests pass.
- E2E smoke (`tests/e2e.test.ts`: init → build → upload_fs → run_tests →
  monitor) still passes.

---

## [2.1.0]

See git history.

## [2.0.0]

- npm distribution + cross-platform installers.
