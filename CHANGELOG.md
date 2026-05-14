# Changelog

All notable changes to **platformio-mcp** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
