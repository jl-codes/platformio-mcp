# Codex Plugin Release and Validation Guide

This guide is the release checklist for the repo-local `platformio-mcp` Codex Plugin. The plugin version must always equal the root npm package version and both artifacts must be built from the same commit.

## Build the artifacts

```bash
npm ci
npm --prefix web ci
npm run plugin:sync:check
npm run plugin:build
npm run plugin:validate
npm run plugin:test
npm run lint
npm audit --audit-level=low
npm --prefix web audit --audit-level=low
npm pack --dry-run
```

`plugin:build` bundles the Node MCP server and production dashboard into `plugins/platformio-mcp/runtime/`, normalizes generated text, and writes a SHA-256 inventory. PlatformIO Core and board toolchains remain external prerequisites.

## Clean-clone acceptance

On Windows, macOS, and Linux:

1. Clone into a new path and install dependencies from the lockfiles.
2. Run the build/validation commands above.
3. Run `node build/cli.js plugin validate --require-runtime`, then `node build/cli.js install --codex-plugin`.
4. Start a new Codex task and confirm eight skills and 42 annotated tools.
5. Temporarily make the source checkout unavailable and verify the cached plugin still initializes, lists tools, and shuts down.
6. Confirm `install --codex` still preserves unrelated `config.toml` content.

Record OS, Node version, package/plugin version, commit, runtime inventory checksum, and pass/fail. Never record launch tickets, cookies, raw device serial numbers, or full local paths in public evidence.

## Browser acceptance

Run unit/component tests and `npm --prefix web run test:e2e:codex`. Verify:

- loopback-only listener by default;
- single-use, 60-second launch ticket and replay rejection;
- HttpOnly SameSite session and ticket-free final URL;
- authenticated REST and Socket.IO;
- CSP, no-referrer, no-sniff, frame, cache, CORS, rate, and request-size controls;
- full desktop and 420-900 px side-panel layouts without horizontal overflow;
- keyboard operation, visible focus, reduced motion, and status announcements;
- no OS browser launch from plugin or scheduled paths;
- honest clickable-link fallback when an in-app browser is unavailable.

Attach scrubbed screenshots of full-width and narrow states to the draft PR.

## Hardware evidence

Use the manual `hardware-e2e.yml` workflow on a labeled self-hosted runner. Cover attached boards as available, with at least one real board required before release. For each board record:

- board family and PlatformIO environment;
- hashed stable target identity and whether the port re-enumerated;
- build, approved flash, monitor, assertion, cancellation, and cleanup outcomes;
- task IDs and relative/redacted artifact paths;
- lock/monitor/process state after completion;
- any unavailable matrix rows and the reason.

Minimum scenarios are ESP32, RP2040, STM32, Arduino-class, no-device, multiple-device ambiguity, and native/simulator. Hardware writes require a current approval. Do not test erase, fuses, bootloader replacement, hazardous actuators, or power outputs unless a separate explicit procedure authorizes them.

For each dispatch, select one checkout-relative fixture, exact PlatformIO environment, exact initial port, board-family label, expected boot marker, and a 1-60 second capture duration. The job will not proceed unless the operator enables `confirm_hardware_write`. It builds and validates the plugin, runs the MCP protocol suite through the bundled plugin launcher, then calls `scripts/run-hardware-acceptance.mjs` for exactly one resolve/build/approved-flash/re-resolve/health/cleanup sequence. A changed device fingerprint or remaining running task fails the run. Repeat the workflow for each applicable hardware-matrix row; one dispatch never sweeps or guesses among boards.

The workflow runs `node scripts/prepare-hardware-evidence.mjs` after the hardware checks. It uploads only `test-results/hardware-evidence/`, which contains bounded, sanitized copies and a path-free SHA-256 manifest. The sanitizer accepts only safe text files from the project-local log and audit directories, rejects symlinks and oversized inputs, and redacts credentials, user paths, serial ports, MAC addresses, hardware IDs, and stable device fingerprints. Raw `.pio-mcp-workspace` logs are never uploaded and remain on the self-hosted runner for local diagnosis. `tests/hardware-evidence.test.ts` verifies both redaction and boundary behavior.

The initial one-board usability gate is documented in the [redacted ESP32-S3 acceptance record](hardware-acceptance-esp32s3.md). It combines a prior user-authorized, SHA-verified physical upload/re-enumeration/serial record with a current read-only check through the exact 42-tool bundled runtime. The record clearly labels that no fresh upload or GPIO change occurred during the current check. This satisfies the minimum requirement for one real board; it does not claim coverage for unavailable board families, deliberate crash injection, or a fresh `hardware-e2e.yml` dispatch.

## Release

1. Update package version and changelog.
2. Regenerate plugin content and runtime.
3. Run all software, browser, package, secret-scan, and available hardware gates.
4. Update the draft PR with exact evidence and residual matrix gaps; mark ready only when required evidence exists.
5. Merge after review, create the signed/tagged release, and publish the exact npm tarball if authorized.
6. Install from the published artifact in a fresh environment and verify the inventory checksum.

## Rollback

Keep the MCP-only installer and previous npm/plugin artifact available. If a regression occurs:

1. disable or remove `platformio-mcp@platformio-mcp` from Codex;
2. install the previous package/tag and run `install --codex-plugin`;
3. retain project-local logs/audit/automation state for diagnosis;
4. pause affected Codex automations through Codex;
5. do not delete PlatformIO projects, approval evidence, or unrelated Codex configuration.

If only automation is unsafe/noisy, remove the `lab_runner` opt-in and pause monitoring automations while keeping interactive read/build/dashboard functionality available.
