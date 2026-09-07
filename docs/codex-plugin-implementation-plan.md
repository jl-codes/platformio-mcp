# PlatformIO MCP Codex Plugin Implementation Plan

## Goal Description

Ship a first-class `platformio-mcp` Codex Plugin from this repository. A developer who clones the repository should be able to discover and install the plugin from the repo-local marketplace, start the bundled PlatformIO MCP server, invoke focused embedded-development skills, use the existing dashboard, and create safe monitoring automations without manually assembling MCP configuration.

The plugin will combine:

- the original 34-tool PlatformIO MCP surface plus eight integration primitives, represented by one typed 42-tool registry;
- focused skills for discovery, bring-up, build diagnosis, flashing, serial monitoring, hardware-in-the-loop testing, and automation setup;
- a dashboard-launch skill that opens the existing authenticated PlatformIO MCP UI in Codex desktop's in-app browser panel and degrades cleanly to a clickable local URL on hosts without that browser;
- explicit tool metadata and server-side policy enforcement for physical-device safety;
- a repo-local marketplace entry, branded install metadata, validation, tests, and release automation;
- bounded, change-aware monitoring primitives that work well in both interactive Codex tasks and unattended scheduled tasks.

The integration is successful when a fresh clone can offer the plugin without requiring users to copy skill folders or edit Codex configuration by hand, and when the plugin can support the complete embedded feedback loop:

1. Inspect the project and active policy.
2. Resolve a single board, environment, and physical device.
3. Build and diagnose.
4. Obtain explicit approval for hardware-changing operations.
5. Flash firmware or a filesystem image.
6. Reattach the serial monitor after port re-enumeration.
7. Evaluate bounded runtime assertions.
8. Open the live dashboard inside Codex for visual inspection, approvals, logs, and task control when the host supports it.
9. Persist evidence and report only meaningful changes.
10. Optionally schedule safe, recurring health checks through Codex.

## Implementation Status (2026-09-06)

This plan is being implemented on draft PR [#20](https://github.com/jl-codes/platformio-mcp/pull/20). The pull request remains intentionally in draft until the physical-board release gate is satisfied.

| Plan area | Current status | Evidence or remaining gate |
| --- | --- | --- |
| Plugin package and marketplace | Implemented | Repo-local marketplace, canonical manifest, branding, eight synced skills, self-contained bundled runtime, install/update flow, cache-portability contracts, version parity, and deterministic inventory are present. |
| Complete MCP integration | Implemented | The typed registry exposes 42 tools with one handler, schema, annotations, policy action, risk classification, skill/command-reference coverage, and automated registry validation. |
| Existing dashboard in Codex | Software-complete | The existing React dashboard is bundled unchanged in purpose and enhanced for narrow Codex panels, authenticated REST/Socket.IO, approvals, task cancellation, monitor state, policy visibility, and safe cursor reset. Chromium acceptance passes for the single-use launch session and 420 px panel. A screenshot-only Playwright case is opt-in. |
| Monitoring and task control | Implemented | Target binding, bounded incremental capture, cursors/digests, health transitions, task history/cancellation, monitor leases, cleanup, and project-local automation state are covered by tests. |
| Automation integration and safety | Validated | The automation skill uses Codex host automations rather than a plugin scheduler; quiet-success, alert/recovery, teardown, and UI-free background behavior are specified. Default profiles cannot perform unattended writes. The explicit `lab_runner` path is independently bounded by exact project/environment/device binding, expiry, cooldown, and write budget. Host create, view, resume, pause, delete, and cleanup acceptance passed with a temporary paused read-only PlatformIO monitor definition. |
| Software verification | Passing locally | 155 root tests, 12 agent/CLI E2E tests, 10 dashboard component tests, 12 plugin tests, and 2 Chromium journeys pass; typecheck, production build, smoke test, sync/manifest validation, deterministic rebuild, package dry-run, and both dependency audits pass. Three additional MCP agent smoke cases are Linux-only and configured in CI. Lint has zero errors. |
| CI, release, and evidence handling | Passing | Windows/macOS/Linux quality and plugin jobs, Chromium, Agent/CLI E2E, package smoke, deterministic rebuild, npm-pack inspection, and dependency audits pass on the draft PR. The obsolete Cline PR Detective workflow is disabled in GitHub and removed from the branch; the repository-owned CI matrix is authoritative. Active workflows use the Node 24-based `actions/checkout@v7` and `actions/setup-node@v7` runtimes while testing the package on Node 20. Manual hardware E2E and sanitized hardware-evidence packaging are defined. Raw hardware logs remain on the self-hosted runner. |
| Physical hardware acceptance | Open release gate | No physical-board commands were run while preparing this implementation. At least one physical-board record, followed by the applicable ESP32/RP2040/STM32/Arduino matrix rows, is still required before the PR can leave draft status or the plugin can be released. |

The status table is the delivery checkpoint; the detailed matrix and release gates below remain authoritative. A software-complete row does not waive its listed manual or hardware proof.

## User Review Required

> [!IMPORTANT]
> **Unattended flashing is disabled by default.** Scheduled tasks may inspect projects, build, query task state, and monitor serial health under the default policy. Flashing, filesystem upload, flash erase, reset, and other hardware-changing operations must continue to require an interactive approval. A separately configured lab-runner profile may permit narrowly scoped unattended hardware-in-the-loop jobs only after an operator binds the policy to a project, environment, and stable device identity.

> [!IMPORTANT]
> **The plugin should be self-contained at install time.** Codex copies local plugins into its plugin cache, so the installed plugin must not depend on relative paths back into the original checkout. The recommended release design is a bundled Node runtime inside the plugin. Phase 0 includes a portability spike to confirm how bundled MCP arguments resolve the plugin root on Windows, macOS, and Linux. If the host cannot resolve the bundled entry point portably, use a version-pinned `npx platformio-mcp@<version>` launcher as the fallback and document the first-run network requirement.

> [!IMPORTANT]
> **Keep the existing `install --codex` flow compatible.** It currently adds only an MCP server block to Codex configuration. Introduce `install --codex-plugin` for the new plugin workflow first. Deprecate or redirect `install --codex` only in a later major release after migration messaging and tests are in place.

> [!IMPORTANT]
> **The first-release UI target is Codex desktop's in-app browser.** The plugin must reuse the existing dashboard rather than reimplement it. An interactive dashboard skill starts or locates the local authenticated dashboard with `open: false`, then asks the Codex host to open the returned launch URL in a right-side browser panel. The Codex CLI and IDE extension do not provide this browser, so they must receive a clickable URL and retain complete headless MCP workflows. Scheduled or background runs must never open UI.

> [!NOTE]
> **Do not add `.app.json` merely to launch a local page.** A future MCP Apps companion view may expose compact status or approval UI through an MCP UI resource, but only after feature-detection, iframe security, and host compatibility tests. It must remain optional and must not replace the full existing dashboard or make tools unusable headlessly.

## Scope

### Included

- Repo-local Codex marketplace and plugin package.
- Plugin manifest, branding, launcher, skills, references, and prompt templates.
- All current PlatformIO MCP capabilities.
- First-class launch and use of the existing dashboard in Codex desktop's in-app browser, including responsive panel layout and non-browser fallbacks.
- Tool annotations and consistent structured results for better Codex planning and approvals.
- Automation-ready monitor snapshots, state cursors, task cancellation, and target resolution.
- Safe scheduled monitoring and build-health workflows.
- Explicit opt-in design for scheduled hardware-in-the-loop workflows.
- Cross-platform local installation, update, validation, CI, and release documentation.

### Not Included

- A hosted PlatformIO service or remote hardware proxy.
- Automatic approval of firmware uploads under the default policy.
- Automatic flash erase, fuse changes, bootloader replacement, or arbitrary shell execution.
- Native USB/device event triggers in Codex. Local hardware monitoring will use bounded polling on a user-selected cadence.
- A replacement for PlatformIO Core, the existing MCP server, or the dashboard.
- A first-release rewrite of the full dashboard as an MCP Apps component.
- Silent telemetry or upload of source code, firmware, logs, device identifiers, or secrets.

## Current-State Baseline

The repository already has most of the execution layer. The plugin should package and harden it rather than duplicate it.

### Existing MCP Capabilities

| Area                       | Existing tools                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Board and device discovery | `list_boards`, `get_board_info`, `list_devices`                                                                                                                |
| Project inspection         | `init_project`, `get_project_config`, `get_project_context`, `system_info`                                                                                     |
| Build and upload           | `build_project`, `clean_project`, `upload_firmware`, `upload_filesystem`, `check_task_status`                                                                  |
| Testing and analysis       | `check_project`, `run_tests`                                                                                                                                   |
| Hardware locking           | `acquire_lock`, `release_lock`, `get_lock_status`, `reset_server_state`                                                                                        |
| Serial monitoring          | `start_monitor`, `stop_monitor`, `query_logs`                                                                                                                  |
| Libraries                  | `search_libraries`, `install_library`, `list_installed_libraries`, `uninstall_library`, `update_library`                                                       |
| Dashboard                  | `get_dashboard_url`                                                                                                                                            |
| Agent workflows            | `agent_validate_project`, `agent_build_diagnose`, `agent_safe_pin_audit`, `agent_flash_monitor_verify`, `agent_get_last_report`, `agent_generate_board_report` |
| Policy                     | `get_policy_status`                                                                                                                                            |

### Existing Assets to Reuse

- The server entry point and MCP tool router in [`src/index.ts`](../src/index.ts).
- Core execution services under [`src/core/`](../src/core/).
- Policy profiles, approval records, audit logs, redaction, and workspace boundaries under [`src/core/policy/`](../src/core/policy/).
- Background task, lock, monitor, log-spool, and artifact infrastructure.
- The dashboard under [`web/`](../web/).
- Existing workflow skills under [`.skills/`](../.skills/).
- The authoritative PlatformIO execution skill under [`.agents/skills/pio-manager/`](../.agents/skills/pio-manager/).
- Existing logo and screenshots under [`docs/assets/`](assets/).
- Cross-platform CI and manual hardware E2E workflows.

### Gaps the Plugin Work Must Close

- No `.codex-plugin/plugin.json` or repo-local plugin marketplace exists.
- `install --codex` configures the MCP server but does not install a plugin or skills.
- Skill copies are split between `.skills/` and `.agents/`, with no drift check or plugin package.
- Tool declarations and call routing are manually maintained in one large entry point.
- Tool definitions do not consistently include MCP read-only, destructive, or idempotency annotations.
- Most responses are JSON embedded in text rather than a stable structured-content contract.
- Monitoring lacks a first-class status tool, bounded capture operation, incremental cursor, and change digest suitable for scheduled runs.
- Background tasks cannot be cancelled through MCP and task history is not exposed as a compact tool.
- Device selection is discoverable but not resolved into a durable target binding before high-risk operations.
- Approval records can be created by policy, but MCP clients cannot read an individual request or list pending requests. Approval itself must remain outside agent authority.
- There is no skill that safely creates, tests, and maintains Codex monitoring automations.
- There is no host-aware flow that opens the authenticated dashboard in Codex's browser panel, reuses it, or falls back correctly on CLI/IDE hosts.
- The dashboard currently exposes a process-lifetime token in tool output and diagnostics and does not explicitly bind its listener to a loopback address; both must be hardened before treating browser launch as a polished plugin surface.

## Target Architecture

```text
platformio-mcp/
├── .agents/
│   └── plugins/
│       └── marketplace.json
├── plugins/
│   └── platformio-mcp/
│       ├── .codex-plugin/
│       │   └── plugin.json
│       ├── .mcp.json
│       ├── assets/
│       │   ├── icon.png
│       │   ├── logo.png
│       │   ├── logo-dark.png
│       │   └── screenshot-dashboard.png
│       ├── runtime/
│       │   ├── platformio-mcp.mjs
│       │   └── web/
│       ├── scripts/
│       │   └── launch-platformio-mcp.mjs
│       └── skills/
│           ├── pio-manager/
│           ├── firmware-bringup/
│           ├── platformio-debug/
│           ├── esp32-flash-monitor/
│           ├── serial-diagnostics/
│           ├── hardware-in-the-loop-test/
│           ├── platformio-dashboard/
│           └── platformio-monitoring-automation/
├── scripts/
│   ├── build-codex-plugin.mjs
│   ├── sync-codex-plugin.mjs
│   └── validate-codex-plugin.mjs
└── tests/
    ├── codex-plugin-manifest.test.ts
    ├── codex-plugin-launcher.test.ts
    ├── codex-plugin-skills.test.ts
    ├── codex-dashboard-browser.test.ts
    └── monitoring-automation.test.ts
```

The checked-in plugin directory is the installable product. Source skills remain in their current repository locations during the first release to minimize disruption. [`scripts/sync-codex-plugin.mjs`](../scripts/sync-codex-plugin.mjs) will deterministically copy them into the plugin and CI will fail when the checked-in plugin is stale. Do not use symlinks because they are unreliable in Windows clones, plugin archives, and marketplace caches.

## Proposed Changes

### 1. Plugin Package and Repo Marketplace

- [NEW] [`.agents/plugins/marketplace.json`](../.agents/plugins/marketplace.json)
  - Create a repo marketplace with a stable kebab-case name and a human-readable `interface.displayName`.
  - Add one `platformio-mcp` entry at `./plugins/platformio-mcp`.
  - Include `policy.installation`, `policy.authentication`, and `category` explicitly.
  - Default installation to `AVAILABLE` and authentication timing to `ON_INSTALL`; the plugin itself does not require an OpenAI API key or a hosted-service login.
  - Keep the entry repo-local so a clone can be added with Codex's marketplace command or discovered by supported desktop project flows.

- [NEW] [`plugins/platformio-mcp/.codex-plugin/plugin.json`](../plugins/platformio-mcp/.codex-plugin/plugin.json)
  - Use `platformio-mcp` as the immutable plugin identifier.
  - Keep the plugin version synchronized with the root package version.
  - Point `skills` at `./skills/` and `mcpServers` at `./.mcp.json`.
  - Include repository, license, homepage, publisher, keywords, and complete interface metadata.
  - Advertise read and write capability because the plugin can inspect projects and, after approval, alter hardware.
  - Include no more than three concise starter prompts, each within the host length limit:
    - inspect and validate a PlatformIO project;
    - build, flash with approval, and verify runtime markers;
    - set up safe recurring serial-health monitoring.
  - Reuse repository artwork and add a dark-mode logo only if visual QA shows it is necessary.
  - Do not include unsupported fields or an `apps` field without a real `.app.json`.

- [NEW] [`plugins/platformio-mcp/.mcp.json`](../plugins/platformio-mcp/.mcp.json)
  - Register one bundled stdio server named `platformio`.
  - Launch through the plugin's cross-platform Node wrapper.
  - Keep all server configuration inside the plugin root and avoid absolute developer-machine paths.
  - Set dashboard auto-open off in the server process. Dashboard launch is an explicit interactive skill flow, and unattended scheduled runs must never create browser tabs.

- [NEW] [`plugins/platformio-mcp/scripts/launch-platformio-mcp.mjs`](../plugins/platformio-mcp/scripts/launch-platformio-mcp.mjs)
  - Resolve and run the bundled server without a shell.
  - Preserve stdio exactly; write diagnostics to stderr only.
  - Forward termination signals and return the child exit code.
  - Prefer the bundled runtime. Permit an explicit development override to a local build, then fall back to the exact matching npm package version only if the bundled runtime is absent.
  - Select `npx.cmd` on Windows and `npx` elsewhere if fallback is required.
  - Never interpolate user text into a shell command.

- [NEW] [`plugins/platformio-mcp/assets/`](../plugins/platformio-mcp/assets/)
  - Derive plugin icon and logo files from [`docs/assets/pio_mcp_220x220.png`](assets/pio_mcp_220x220.png).
  - Add one current dashboard screenshot after removing project paths, ports, tokens, and device identifiers.
  - Validate image existence, format, dimensions, contrast, and file size in CI.

### 2. Reproducible Plugin Build and Skill Synchronization

- [NEW] [`scripts/sync-codex-plugin.mjs`](../scripts/sync-codex-plugin.mjs)
  - Maintain an explicit source-to-plugin map for every bundled skill and reference.
  - Copy files deterministically with normalized line endings and stable ordering.
  - Synchronize the plugin version and the version-pinned fallback launcher with [`package.json`](../package.json).
  - Support `--check` to report drift without writing.
  - Reject duplicate skill names, missing `SKILL.md` files, unresolved relative references, and stale copied assets.

- [NEW] [`scripts/build-codex-plugin.mjs`](../scripts/build-codex-plugin.mjs)
  - Bundle the Node MCP server and production dependencies into `plugins/platformio-mcp/runtime/`.
  - Copy required dashboard assets while excluding source maps, tests, logs, caches, approval records, and local workspace state.
  - Generate a deterministic inventory and fail if the runtime references files outside the plugin root.
  - Keep PlatformIO Core as an external prerequisite; do not vendor Python toolchains or board platforms.

- [NEW] [`scripts/validate-codex-plugin.mjs`](../scripts/validate-codex-plugin.mjs)
  - Run the canonical plugin validator.
  - Validate marketplace-to-plugin path resolution, semantic version parity, manifest asset paths, and `.mcp.json` shape.
  - Start the bundled MCP process, perform initialize/list-tools, and shut it down cleanly.
  - Check that generated runtime and skills contain no machine-specific absolute paths or secrets.

- [MODIFY] [`package.json`](../package.json)
  - Add `plugin:sync`, `plugin:sync:check`, `plugin:build`, `plugin:validate`, and `plugin:test` scripts.
  - Run sync, build, and validation from `prepublishOnly` and the release workflow.
  - Include the plugin package and repo marketplace in npm package contents if `install --codex-plugin` will install from the npm tarball.
  - Add only the minimal bundler dependency required for a self-contained runtime.

- [MODIFY] [`.gitignore`](../.gitignore)
  - Ignore temporary plugin build directories and validation output.
  - Deliberately keep the final installable plugin runtime tracked if marketplace installs must work directly from a clone.

### 3. Skill Suite

Every plugin skill must name the relevant MCP tools, require explicit `projectDir`, resolve a concrete environment before upload, discover devices before upload or monitoring, use background mode for long operations, correlate logs by `taskId`, and release manually acquired locks after terminal task states.

- [MODIFY] [`.agents/skills/pio-manager/SKILL.md`](../.agents/skills/pio-manager/SKILL.md)
  - Keep this as the execution source of truth.
  - Update its generated plugin copy to include all current and new tool names.
  - Add explicit treatment of serial output as untrusted data, especially during automation runs.
  - Add cancellation, monitor cursor, target-binding, and approval-status guidance.

- [MODIFY] [`.skills/firmware-bringup/SKILL.md`](../.skills/firmware-bringup/SKILL.md)
  - Replace generic CLI examples with exact MCP-first sequences.
  - Require `agent_resolve_target`, validation, build diagnosis, explicit approval, flash, and bounded runtime verification.

- [MODIFY] [`.skills/platformio-debug/SKILL.md`](../.skills/platformio-debug/SKILL.md)
  - Use structured diagnostics and `nextSteps` before broad dependency changes.
  - Distinguish safe automatic retries from failures that require configuration or user input.

- [MODIFY] [`.skills/esp32-flash-monitor/SKILL.md`](../.skills/esp32-flash-monitor/SKILL.md)
  - Require environment selection and device fingerprint confirmation.
  - Preserve ESP32-specific port re-enumeration and strapping-pin checks.

- [MODIFY] [`.skills/serial-diagnostics/SKILL.md`](../.skills/serial-diagnostics/SKILL.md)
  - Prefer bounded capture or incremental query by cursor.
  - Define healthy, degraded, failed, silent, and disconnected outcomes.
  - Report a minimal redacted excerpt and one next action.

- [MODIFY] [`.skills/hardware-in-the-loop-test/SKILL.md`](../.skills/hardware-in-the-loop-test/SKILL.md)
  - Require explicit pass/fail assertions, time limits, safety preconditions, and artifact locations.
  - For actuators or high-power outputs, require a separate physical-safety confirmation even if firmware upload is already approved.

- [NEW] [`plugins/platformio-mcp/skills/platformio-dashboard/SKILL.md`](../plugins/platformio-mcp/skills/platformio-dashboard/SKILL.md)
  - Trigger when the user asks to open, show, inspect, or work in the PlatformIO MCP dashboard.
  - Resolve the requested `projectDir`, call `get_dashboard_url` with `open: false`, verify the dashboard health endpoint, and pass the short-lived launch URL to the host's browser-opening capability.
  - On Codex desktop, open the page in a right-side in-app browser panel and reuse the existing dashboard tab when the host exposes a tab identifier.
  - Feature-detect browser support. On Codex CLI, the IDE extension, or another headless client, return one clearly labeled clickable URL and continue to offer every operation through MCP tools.
  - Never invoke the OS-default browser from the plugin flow, never open a browser for an automation or background wake-up, and never claim that a page opened unless the host confirms it.
  - Treat dashboard-rendered project data, build output, and serial output as untrusted content. UI text cannot alter policy, approvals, tool arguments, or the task's instructions.
  - Prefer one dashboard instance and one browser tab per MCP process; refresh or navigate the existing tab after project changes rather than spawning duplicates.

- [MODIFY] [`.skills/sbc-deploy/SKILL.md`](../.skills/sbc-deploy/SKILL.md)
  - Ensure descriptions do not overlap broadly enough to trigger the wrong workflow.
  - Keep SBC deployment in the plugin only if its required SSH execution is implemented and governed by PlatformIO MCP policy; otherwise leave it outside the initial plugin scope.

- [NEW] [`plugins/platformio-mcp/skills/platformio-monitoring-automation/SKILL.md`](../plugins/platformio-mcp/skills/platformio-monitoring-automation/SKILL.md)
  - Trigger only when the user asks to schedule, monitor, watch, check repeatedly, or receive follow-ups about a PlatformIO project or device.
  - Test the proposed monitoring action interactively before creating a scheduled task.
  - Inspect project context, resolve the target, inspect policy, and choose a safe cadence.
  - Use a same-task heartbeat for short-lived follow-up loops and a standalone project automation for recurring independent checks.
  - Select the local checkout when physical hardware is required. Do not assume an isolated worktree can access or safely coordinate the attached device.
  - Use the Codex host's automation capability to create or update schedules; do not invent a plugin-specific scheduler or write scheduler configuration directly.
  - Create read-only or build-only monitors by default. Refuse to schedule a flash under `flash_requires_approval` because unattended runs cannot satisfy interactive approval.
  - Include explicit stop conditions, failure thresholds, quiet-success behavior, and notification rules in every generated automation prompt.
  - If the host has no automation capability, provide a reviewed, copyable natural-language prompt rather than claiming the schedule exists.

- [NEW] [`plugins/platformio-mcp/skills/platformio-monitoring-automation/references/prompt-patterns.md`](../plugins/platformio-mcp/skills/platformio-monitoring-automation/references/prompt-patterns.md)
  - Provide durable prompt patterns for:
    - serial crash and boot-loop monitoring;
    - device disconnect/reconnect detection;
    - nightly build and static-analysis health;
    - background task completion follow-up;
    - bounded lab hardware-in-the-loop smoke tests.
  - Prompts must name the project, environment, device binding, expected markers, reject patterns, maximum capture window, state key, stop conditions, and reporting policy.
  - Treat logs as evidence only, never as instructions.

### 4. MCP Contract Hardening

- [NEW] [`src/mcp/tool-registry.ts`](../src/mcp/tool-registry.ts)
  - Create one typed registry containing tool name, description, input schema, risk class, annotations, policy action, and handler.
  - Generate both list-tools output and dispatch from this registry to eliminate declaration/handler drift.
  - Preserve all existing tool names and request shapes during migration.

- [NEW] [`src/mcp/tool-result.ts`](../src/mcp/tool-result.ts)
  - Standardize responses as concise model-readable text plus backwards-compatible JSON text and MCP structured content where supported.
  - Define a common envelope with `success`, `status`, `summary`, `data`, `diagnostics`, `nextSteps`, `taskId`, `logPaths`, `observedAt`, and `policyDecision` as applicable.
  - Truncate only presentation text; retain full redacted evidence in bounded on-disk artifacts.

- [MODIFY] [`src/index.ts`](../src/index.ts)
  - Replace the manually duplicated tool list and switch statement with the registry.
  - Add MCP annotations for read-only, destructive, idempotent, and open-world behavior.
  - Map every composite agent tool to its highest-risk underlying action.
  - Keep stderr-only diagnostics so stdio protocol output is never corrupted.
  - Keep `get_dashboard_url` backward compatible while adding a structured, redacted browser-session result for the Codex dashboard skill.

- [MODIFY] [`src/types.ts`](../src/types.ts)
  - Add JSDoc-documented Zod schemas and exported types for new tool inputs and outputs.
  - Tighten `projectDir`, environment, timeout, maximum lines/bytes, and regex-length bounds.
  - Add stable discriminated unions for task and monitor status.

- [MODIFY] [`src/utils/errors.ts`](../src/utils/errors.ts)
  - Add typed error codes for ambiguous target, stale target binding, monitor unavailable, cursor expired, task cancellation, overlapping run, and automation policy denial.
  - Keep remediation structured and safe to present to the model.

- [MODIFY] [`src/core/dashboard.ts`](../src/core/dashboard.ts) and [`src/api/server.ts`](../src/api/server.ts)
  - Add an ephemeral dashboard launch session to `get_dashboard_url`: return `baseUrl`, `launchUrl`, `expiresAt`, `projectDir`, and `status` in structured content without echoing a reusable raw token in model-facing text.
  - Exchange a short-lived, single-use launch ticket for an `HttpOnly`, `SameSite=Strict` session cookie, remove the ticket from browser history immediately, and reject expired or replayed tickets.
  - Preserve legacy response fields for one documented compatibility window, mark them sensitive/deprecated, and ensure the plugin skill uses only the ephemeral session form.
  - Bind the dashboard listener explicitly to `127.0.0.1` by default, support an intentional loopback IPv6 mode, and require separate explicit configuration plus warnings for any non-loopback bind.
  - Stop printing authentication material to stderr, redact launch URLs in logs and task output, and expose only an unauthenticated minimal `/healthz` response.
  - Add a strict Content Security Policy, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, restrictive CORS/origin checks, bounded request bodies, rate limits, and authenticated Socket.IO handshakes.
  - Keep OS-browser opening available only for the legacy CLI command. The plugin always requests `open: false` and lets Codex own panel placement.

### 5. Automation-Ready Targeting, Tasks, and Monitoring

#### New Tool Contracts

| Tool                     | Risk      | Purpose                                                                                                                                 |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_resolve_target`   | Read-only | Resolve exactly one project environment, board, port, and stable device fingerprint; return ambiguity instead of guessing.              |
| `get_monitor_status`     | Read-only | Report active/inactive/stale state, port, baud, project, lease owner, log path, cursor, and last activity.                              |
| `capture_serial_window`  | Medium    | Acquire a bounded monitor lease, capture for a capped interval, return redacted incremental output, and release or restore prior state. |
| `agent_monitor_health`   | Medium    | Evaluate expected and rejected patterns, disconnects, silence, resets, and change state for interactive or scheduled monitoring.        |
| `cancel_task`            | Medium    | Cancel one known background task and release only resources owned by that task.                                                         |
| `list_task_history`      | Read-only | Return a compact, project-scoped list of recent tasks and terminal states.                                                              |
| `get_approval_request`   | Read-only | Return status and expiry for one approval request without providing any approval mutation.                                              |
| `list_pending_approvals` | Read-only | Return project-scoped pending requests so interactive users can act through the CLI or dashboard.                                       |

Do not expose `approve` or `deny` as agent-callable MCP tools. Those actions remain user-controlled through the dashboard or CLI.

- [NEW] [`src/core/target-resolution.ts`](../src/core/target-resolution.ts)
  - Parse `platformio.ini` environments and board IDs.
  - Match attached devices using port plus stable hardware identity fields such as VID, PID, serial number, and board metadata where available.
  - Return confidence and ambiguity; never choose between multiple plausible devices for a write operation.
  - Produce a short-lived target binding digest used by flash and monitor operations to detect device substitution or port drift.

- [NEW] [`src/core/monitor-health.ts`](../src/core/monitor-health.ts)
  - Implement bounded capture and health classification.
  - Accept expected markers, rejected patterns, silence timeout, capture duration, stability window, prior cursor, and an `automationKey`.
  - Return `healthy`, `degraded`, `failed`, `silent`, `disconnected`, or `inconclusive`.
  - Return `changed`, a new cursor, a state digest, matched/unmatched expectations, redacted evidence, and one recommended action.
  - Debounce repeated findings and track consecutive failures without suppressing a recovery event.

- [NEW] [`src/core/automation-state.ts`](../src/core/automation-state.ts)
  - Persist state under `.pio-mcp-workspace/automations/<automation-key>.json`.
  - Store only cursor, digest, last status, consecutive failure count, target binding, and timestamps.
  - Use atomic writes and a per-key lock to prevent overlapping scheduled runs.
  - Bound retention and recover safely from corrupt or old state.

- [MODIFY] [`src/core/monitor.ts`](../src/core/monitor.ts)
  - Add monitor leases and explicit status inspection.
  - Ensure upload can pause an owned monitor, flash, wait for re-enumeration, and restore monitoring on the resolved device.
  - Ensure bounded capture always cleans up its lease on success, failure, cancellation, and process termination.

- [MODIFY] [`src/tools/monitor.ts`](../src/tools/monitor.ts)
  - Add cursor-based reads, byte limits, timestamps, and structured pattern matches.
  - Prefer `taskId` correlation when a monitor belongs to an upload or composite workflow.
  - Reject unsafe regular expressions or evaluate patterns with strict size/time bounds.

- [MODIFY] [`src/core/tasks.ts`](../src/core/tasks.ts) and [`src/utils/process-manager.ts`](../src/utils/process-manager.ts)
  - Add task cancellation and compact history.
  - Make cancellation idempotent and ownership-scoped.
  - Persist terminal state before releasing locks.
  - Reconcile stale process records after crashes without killing unrelated host processes.

- [MODIFY] [`src/tools/agent.ts`](../src/tools/agent.ts)
  - Use target binding in `agent_flash_monitor_verify`.
  - If a background pre-build is returned, persist a resumable workflow state and return the exact next status action.
  - Add `agent_resolve_target` and `agent_monitor_health` orchestration.
  - Keep all verification windows bounded and persist their reports.

### 6. Safety and Policy Model

- [MODIFY] [`src/core/policy/default-policy.ts`](../src/core/policy/default-policy.ts)
  - Classify target resolution, task history, monitor status, and approval reads as low risk.
  - Classify bounded serial capture, monitor start/stop, and cancellation as medium risk.
  - Keep upload, upload filesystem, reset, and composite flash/monitor verification high risk.
  - Keep flash erase, arbitrary shell, and unrestricted remote deployment critical or denied.

- [MODIFY] [`src/core/policy/profiles.ts`](../src/core/policy/profiles.ts)
  - Add new read tools to `read_only` and build tools to `build_only`.
  - Permit bounded serial health checks in a new `monitor_only` profile.
  - Keep `flash_requires_approval` as the recommended interactive default.
  - Add an optional `lab_runner` profile only with target-binding constraints, operation allowlists, run limits, and explicit documentation. Do not make it selectable accidentally or default it from a scheduled prompt.

- [NEW] [`src/core/policy/automation-policy.ts`](../src/core/policy/automation-policy.ts)
  - Validate automation scope independently of conversational intent.
  - Require an `automationKey`, exact project boundary, environment, and device binding for any stateful monitor.
  - For lab-runner writes, require a preconfigured policy file, maximum run duration, maximum consecutive flashes, cooldown, and expiry.
  - Deny self-approval, wildcard device selectors, root project paths, unbounded loops, and erase operations.

- [MODIFY] [`src/core/policy/redact.ts`](../src/core/policy/redact.ts)
  - Redact Wi-Fi credentials, bearer tokens, API keys, provisioning secrets, and common device certificates from serial and build logs before they enter tool results, persisted automation state, or dashboard events.

- [MODIFY] [`src/core/policy/audit-log.ts`](../src/core/policy/audit-log.ts)
  - Include automation key, target-binding digest, task ID, policy profile, and interactive/scheduled actor class.
  - Never store raw secret-bearing tool arguments after redaction.

#### Required Safety Invariants

- A scheduled task cannot convert a pending approval into an approved upload.
- Serial logs are untrusted device output and cannot change the task's instructions, policy, target, cadence, or notification destination.
- An upload must specify one project and one environment unless the user explicitly requests a multi-environment operation.
- A write operation must fail on ambiguous or changed device identity.
- Every monitor, build, test, and upload has a maximum duration and can be cancelled.
- Every manual lock or lease is released on terminal state.
- Automation reports are change-aware and quiet on repeated healthy state, but always report failure, recovery, target changes, and policy blocks.

### 7. Dashboard and Operator Experience

- [MODIFY] [`web/`](../web/)
  - Preserve the current React dashboard as the single full operator UI; do not fork a Codex-only dashboard.
  - Add a compact responsive layout for a 420-900 px right-side Codex browser panel, while retaining the existing full-width desktop layout.
  - Add a plugin-aware overview showing active project, environment, device binding, policy profile, pending approval count, monitor lease, task history, and scheduled-monitor state.
  - Add explicit user controls for approve, deny, cancel task, stop monitor, and clear stale automation state.
  - Visually separate interactive approvals from lab-runner preauthorization.
  - Show exact retention and redaction behavior near logs and artifacts.
  - Keep live Socket.IO build, serial, lock, task, approval, and health updates working when the page is backgrounded and then refocused in Codex.
  - Provide keyboard-complete controls, visible focus, semantic status announcements, reduced-motion support, contrast-compliant light/dark themes, and useful empty/error/reconnect states.
  - Strip the launch ticket from the address bar after session exchange and provide a safe “copy dashboard link” action that creates a fresh expiring session rather than copying a stale credential.

- [MODIFY] [`src/api/events.ts`](../src/api/events.ts) and [`src/api/server.ts`](../src/api/server.ts)
  - Emit target, task, monitor-health, approval, recovery, and cancellation events.
  - Keep event payloads compact, redacted, and project-scoped.
  - Preserve existing dashboard behavior for users who install only the MCP server.
  - Scope every REST and Socket.IO request to the authenticated dashboard session and selected workspace; reject cross-project identifiers and stale sessions.

- [MODIFY] [`src/tools/projects.ts`](../src/tools/projects.ts)
  - Include plugin/runtime version, project policy summary, and dashboard availability in project context.

- [NEW] [`web/e2e/codex-browser.spec.ts`](../web/e2e/codex-browser.spec.ts)
  - Exercise authenticated launch, ticket cleanup, responsive panel layout, project switching, reconnect, live log rendering, approvals, cancellation, and session expiry in Chromium.
  - Run the same core dashboard journeys at full desktop width and a narrow Codex-panel viewport.
  - Add deterministic visual snapshots for light/dark, empty, running, failed, approval-required, and disconnected states; mask paths, ports, tokens, timestamps, and device identifiers.

- [NEW] [`tests/codex-dashboard-browser.test.ts`](../tests/codex-dashboard-browser.test.ts)
  - Verify loopback-only binding, one-time session exchange, expiration/replay denial, redacted MCP results, idempotent server startup, and no OS-browser launch when `open: false`.
  - Verify that automation-tagged calls cannot request browser opening and that repeated interactive opens reuse the same local server.

#### Codex UI Integration Contract

1. The user asks to open or show the PlatformIO dashboard.
2. The dashboard skill calls `get_dashboard_url({ projectDir, open: false })` and receives a short-lived launch session.
3. If the host supports an in-app browser, the skill asks it to open or reuse a right-side browser panel and reports the confirmed result.
4. If the host has no in-app browser, the skill returns the expiring clickable URL and concise manual-open instructions; all requested work remains possible through MCP tools.
5. The dashboard exchanges the launch ticket, removes it from browser history, authenticates REST and Socket.IO traffic, and renders the existing live UI.
6. Closing a browser tab does not stop builds or monitors. Stopping the MCP server invalidates sessions and terminates dashboard-owned resources cleanly.

The MCP tools remain the canonical execution API. The browser is a complementary human-control surface, not a hidden requirement. A later MCP Apps view may render compact status or confirmation cards by attaching an MCP UI resource to a dedicated render tool, but data tools must stay decoupled from presentation and host extensions must be feature-detected rather than selected by host-name checks.

### 8. Installer, Documentation, and Migration

- [MODIFY] [`scripts/installers/codex.js`](../scripts/installers/codex.js)
  - Preserve the existing direct-MCP installer.
  - Add a distinct plugin installation path that validates the bundled plugin, installs or registers the appropriate marketplace, and prints verification steps.
  - Back up any user-owned marketplace file before a first write and preserve unrelated marketplace entries.
  - Never overwrite unrelated Codex settings.
  - Explain that a new Codex task is required after plugin reinstall so new skills and tools are loaded.

- [MODIFY] [`src/cli.ts`](../src/cli.ts)
  - Add `install --codex-plugin` and `plugin validate` commands.
  - Add read-only CLI equivalents for target resolution, monitor health/status, task history, and approval status.
  - Keep approval mutations explicitly user-invoked.

- [MODIFY] [`README.md`](../README.md)
  - Add a short “Codex Plugin” quick start for repo clones and npm users.
  - Explain prerequisites: Node, PlatformIO Core, local hardware access, and optional dashboard.
  - Distinguish plugin installation from legacy MCP-only installation.

- [MODIFY] [`docs/CODEX.md`](CODEX.md)
  - Document plugin discovery, install, enable/disable, update, cache behavior, and troubleshooting.
  - Document default tool approval posture and server policy profiles.
  - Explain why local hardware schedules need the computer on, the desktop app running, and the physical project checkout selected.

- [MODIFY] [`docs/CODEX_PROMPT_COOKBOOK.md`](CODEX_PROMPT_COOKBOOK.md)
  - Add copyable prompts for target resolution, bounded serial health, task follow-up, build monitoring, safe automation creation, and automation teardown.
  - Include no prompt that silently authorizes a flash.

- [NEW] [`docs/CODEX_PLUGIN_RELEASE.md`](CODEX_PLUGIN_RELEASE.md)
  - Define version synchronization, validation, cachebuster use during local iteration, release tagging, marketplace update, and rollback.
  - Document both repo marketplace and public universal-directory paths without assuming public acceptance.

- [MODIFY] [`docs/MCPServerCommandReference.md`](MCPServerCommandReference.md)
  - Add the new tool contracts, examples, annotations, output envelopes, risk levels, and automation usage notes.

### 9. CI, Release, and Distribution

- [MODIFY] [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
  - Run plugin sync drift checks and manifest validation on Linux and Windows.
  - Build the plugin from a clean checkout and initialize its bundled MCP server.
  - Validate that no plugin file escapes the plugin root or contains a local absolute path.
  - Test the version-pinned fallback without publishing.
  - Build and unit-test the dashboard, run Chromium browser journeys on every pull request, and run the full Chromium/Firefox/WebKit visual suite on release candidates.
  - Run accessibility, secret-scanning, dependency-audit, and dashboard security-header checks with deterministic fixtures.

- [MODIFY] [`.github/workflows/hardware-e2e.yml`](../.github/workflows/hardware-e2e.yml)
  - Add a plugin-installed test path on the self-hosted rig.
  - Exercise discover, resolve, build, approved flash, monitor reattach, runtime assertions, cancellation, and lock release.
  - Add a repeated monitor-health run to prove change detection and recovery reporting.
  - Require exact project/environment/port inputs and an explicit workflow-dispatch hardware-write confirmation.
  - Run protocol tests through the bundled plugin launcher, reject a post-flash device-identity change, prove no tracked task remains, and upload only sanitized evidence.

- [NEW] [`.github/workflows/release.yml`](../.github/workflows/release.yml)
  - Build and validate plugin artifacts from the same commit as the npm package.
  - Verify package/plugin semantic version parity.
  - Produce a deterministic plugin archive and checksum.
  - Publish only after npm/package smoke tests pass.
  - Keep universal-directory submission a manual, separately authorized release step.

## Feature-Completeness Traceability Matrix

The typed tool registry is the inventory source of truth. CI must generate a coverage report and fail when a public tool is omitted from the plugin manifest, all relevant policy profiles, at least one skill or command-reference entry, and an automated contract test. Composite tools must additionally trace each underlying action and inherit its highest risk.

| User journey                              | MCP surface                                                                                                                              | Skill or UI surface                                            | Required proof                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Discover boards and attached devices      | `list_boards`, `get_board_info`, `list_devices`, `agent_resolve_target`                                                                  | `pio-manager`, bring-up flow, dashboard device state           | Fixture unit tests, zero/one/many-device cases, physical enumeration                           |
| Inspect and initialize projects           | `init_project`, `get_project_config`, `get_project_context`, `system_info`                                                               | bring-up and debug skills, dashboard project selector          | Workspace-boundary, malformed-config, and clean-clone tests                                    |
| Manage libraries                          | Search, list, install, update, and uninstall library tools                                                                               | `pio-manager`, dependency view                                 | Read/write policy tests and isolated fixture project                                           |
| Validate, analyze, build, clean, and test | `check_project`, `build_project`, `clean_project`, `run_tests`, `agent_validate_project`, `agent_build_diagnose`, `agent_safe_pin_audit` | debug and bring-up skills, build/log views                     | Diagnostic snapshots, background completion, cancellation, native simulator                    |
| Coordinate tasks and hardware             | Lock tools, status/history, cancellation, target binding, server-state reset                                                             | `pio-manager`, dashboard task/lock controls                    | Ownership, contention, timeout, crash-recovery, and stale-lock tests                           |
| Flash firmware and filesystems            | `upload_firmware`, `upload_filesystem`, approval reads                                                                                   | bring-up, ESP32, and HIL skills; approval UI                   | Denial/approval/expiry tests plus physical-board upload evidence                               |
| Monitor serial runtime                    | Monitor start/stop/status, incremental logs, bounded capture, health evaluation                                                          | serial diagnostics, ESP32, HIL, dashboard live console         | Cursor, redaction, reconnect, silence, crash, recovery, and leak tests                         |
| Run composite agent workflows             | Flash-monitor-verify and report tools                                                                                                    | Workflow skills and report/history UI                          | Risk inheritance, resumability, artifacts, and end-to-end board tests                          |
| Review policy and approvals               | Policy status and read-only approval tools                                                                                               | Dashboard approval controls and documentation                  | Agent cannot self-approve; UI mutations are authenticated and audited                          |
| Open and operate the dashboard            | Hardened `get_dashboard_url` session result and project context                                                                          | `platformio-dashboard`, Codex browser panel, existing React UI | Session security, panel/full-width E2E, visual, accessibility, live-update, and fallback tests |
| Schedule safe monitoring                  | Monitor health/state tools and Codex host automation capability                                                                          | monitoring-automation skill, dashboard schedule status         | Create/update/pause/resume/delete, quiet success, alert/recovery, no unattended default flash  |
| Install, update, and recover              | Plugin launcher, validator, installer, legacy MCP path                                                                                   | Repo marketplace, CLI, docs                                    | Fresh clone, cache isolation, upgrade, uninstall, rollback, and cross-platform tests           |

Feature-complete means every row passes its software proof, safety proof, and—where physical behavior is involved—the applicable hardware evidence. A polished UI alone cannot substitute for a missing headless contract, and a listed MCP tool without a safe skill path and test is not considered integrated.

## Automation Design

### Host and Plugin Responsibilities

| Responsibility                                | Codex host                          | PlatformIO MCP plugin                |
| --------------------------------------------- | ----------------------------------- | ------------------------------------ |
| Store cadence and wake a task                 | Yes                                 | No                                   |
| Choose same-task heartbeat or standalone run  | Yes, guided by the automation skill | No                                   |
| Access the selected local project             | Yes                                 | Validate boundary                    |
| Resolve board/environment/device              | Orchestrate                         | Perform deterministic resolution     |
| Start, stop, and query serial capture         | Call tools                          | Execute with leases and limits       |
| Persist incremental monitor state             | Invoke with `automationKey`         | Persist project-local cursor/digest  |
| Decide whether hardware writes are authorized | Enforce host approval posture       | Enforce independent server policy    |
| Notify the user                               | Scheduled-task inbox/notifications  | Return meaningful structured changes |

### Default Monitoring Run

1. Load the named plugin skill and explicit project path.
2. Call `get_policy_status` and stop if the expected monitor/build operation is denied.
3. Call `agent_resolve_target`; stop on ambiguity or changed identity.
4. Call `agent_monitor_health` with a bounded capture window, expected markers, reject patterns, prior state key, and maximum output size.
5. If `changed` is false and status remains healthy, return a compact no-change result and avoid noisy notification text.
6. If status worsens, target identity changes, or the device disconnects, report evidence and one safe next action.
7. If status recovers, report the recovery once and reset consecutive-failure state.
8. Never patch code or flash firmware unless the saved automation explicitly includes those actions and server policy independently permits them.

### Recommended Automation Templates

| Template                    | Default cadence                          | Allowed profile               | Notification behavior                                                     |
| --------------------------- | ---------------------------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| Serial crash watch          | Every few minutes while debugging        | `monitor_only`                | Notify on first failure, changed signature, and recovery.                 |
| Device presence watch       | Every few minutes                        | `read_only`                   | Notify on disconnect, replacement, or reconnect.                          |
| Nightly build health        | Once nightly                             | `build_only`                  | Notify on regression or recovery; attach task/log references.             |
| Long build/upload follow-up | Short same-task intervals until terminal | Depends on originating action | Stop automatically at completed, failed, cancelled, or approval-required. |
| Lab HIL smoke test          | Operator-selected maintenance cadence    | Explicit `lab_runner` only    | Always report run outcome and halt after configured failure threshold.    |

### Lab-Runner Preconditions

A scheduled hardware-in-the-loop run is valid only when all of the following are configured outside the automation prompt:

- a non-default `lab_runner` policy is present in the exact project;
- the project, environment, board ID, and device fingerprint are allowlisted;
- the fixture is physically safe for unattended operation;
- the test has expected and rejected runtime assertions;
- flash count, cooldown, run duration, and consecutive-failure limits are set;
- erase, bootloader, fuse, arbitrary shell, and high-power actuator operations remain denied;
- a user-visible kill switch and audit trail are available in the dashboard;
- the first run has been executed and reviewed interactively.

## Delivery and Draft PR Workflow

- Open a plan-only draft pull request from `codex/platformio-mcp-plugin-plan` before implementation. Its first commit contains only this document so architecture, safety, UI, and release assumptions can be reviewed independently of unrelated working-tree changes.
- Use the draft PR description as the delivery dashboard: link each implementation phase, the generated feature-coverage report, UI screenshots, hardware evidence, security findings, and unresolved reviewer decisions.
- Land implementation in reviewable commits ordered by the phases below. Avoid generated-runtime churn until launcher and cache-portability decisions are accepted.
- Keep the PR in draft while any release gate is open. Mark it ready only after required software checks pass, at least one physical-board E2E record is attached, dashboard screenshots have been reviewed, and the rollback path has been exercised.
- Require maintainer review for policy-profile changes, dashboard approval mutations, marketplace metadata, and release automation. Resolve security findings before expanding from the repo marketplace to any public directory.
- The draft PR may be split into stacked implementation PRs if review size becomes excessive, but this plan remains the parent checklist and every child PR must identify the matrix rows and gates it satisfies.

## Implementation Sequence

### Phase 0: Contract and Portability Spike

1. Scaffold `plugins/platformio-mcp` and the repo marketplace with the canonical plugin creator tooling.
2. Confirm local marketplace discovery and cache behavior from a clean clone.
3. Verify bundled MCP entry-point path resolution on Windows, macOS, and Linux.
4. Verify that Codex desktop can open the authenticated local dashboard in a right-side browser panel and document the CLI/IDE fallback.
5. Choose the bundled runtime launcher or the pinned `npx` fallback based on evidence.
6. Record the decisions and exact install/update commands in the release guide.

Exit criteria: a minimal plugin installs from the repo marketplace, starts one MCP server, lists tools, opens the existing dashboard in Codex desktop without launching an external browser, falls back correctly on non-browser hosts, and survives being copied into the Codex plugin cache.

### Phase 1: Package Existing Capabilities

1. Add the production manifest, marketplace metadata, launcher, assets, and runtime build.
2. Synchronize the existing skills into the plugin.
3. Add the dashboard-launch skill and ephemeral browser-session contract.
4. Add manifest, path, version, launcher, and dashboard-session tests.
5. Update the installer and README with an opt-in plugin flow.

Exit criteria: the plugin exposes all existing tools and skills, opens one secure dashboard panel on request, and does not change current MCP-only consumers.

### Phase 2: MCP Contract Hardening

1. Introduce the typed tool registry and common result envelope.
2. Add tool annotations and policy-action mappings.
3. Preserve request and text-response compatibility.
4. Add contract snapshots and negative schema tests.

Exit criteria: every listed tool has exactly one handler, schema, risk class, annotation set, and policy mapping.

### Phase 3: Monitoring and Task Primitives

1. Add target resolution and binding.
2. Add monitor status, bounded capture, cursors, health classification, and automation state.
3. Add task cancellation and history.
4. Add read-only approval-status tools.
5. Integrate the new state into the dashboard and audit trail.

Exit criteria: two consecutive monitoring runs consume only new log content, repeated healthy state is quiet, failures and recoveries are emitted once, and all resources are released.

### Phase 4: Automation Skill and Safety Profiles

1. Add and test the automation skill and prompt patterns.
2. Add `monitor_only` policy.
3. Add the optional constrained `lab_runner` design behind explicit configuration.
4. Verify that default scheduled runs cannot approve or invoke a flash.
5. Manually create, update, pause, resume, and delete representative Codex automations.

Exit criteria: an interactive request can create a working serial or build monitor, and the same request cannot create an unattended flash under the default profile.

### Phase 5: Cross-Platform and Hardware Validation

1. Run clean-clone plugin tests on Windows, macOS, and Linux.
2. Run manual hardware E2E on representative ESP32, RP2040, STM32, and Arduino-class boards as available.
3. Verify port re-enumeration, multiple-device ambiguity, cancellation, process crash recovery, and stale locks.
4. Review dashboard usability and redaction.
5. Run authenticated browser-panel journeys, accessibility checks, responsive visual regression, and session-security tests.

Exit criteria: all software and browser checks pass and the hardware matrix produces archived evidence with no leaked secrets or unreleased resources.

### Phase 6: Release

1. Synchronize package and plugin versions.
2. Build deterministic npm and plugin artifacts from one commit.
3. Validate a fresh install and update from the repo marketplace.
4. Attach final panel/full-width screenshots, feature-coverage output, and hardware evidence to the draft PR and mark it ready for review.
5. Publish npm and tagged repository release after merge approval.
6. Observe local adoption before separately pursuing universal-directory publication.

Exit criteria: release artifacts, checksum, install instructions, migration notes, and rollback instructions are published and verified.

## Verification Plan

### Automated Verification

- `npm run lint`
- `npx tsc --noEmit`
- `npm run test:ci:unit`
- `npm run test:e2e:ci`
- `npm run plugin:sync:check`
- `npm run plugin:build`
- `npm run plugin:validate`
- `npm run plugin:test`
- `npm run smoke-test`
- `npm --prefix web run lint`
- `npm --prefix web run build`
- `npm --prefix web run test -- --run`
- `npm --prefix web run test:e2e -- --project=chromium`
- Package dry-run using the repository-local npm cache, asserting that plugin, marketplace, installer, and runtime files are present.

### Plugin Contract Tests

- Manifest accepts the canonical validator and contains no placeholders.
- Plugin folder name, manifest name, marketplace name, and source path agree.
- All manifest paths begin with `./`, stay inside the plugin root, and exist.
- Plugin version equals the root package version.
- Starter prompts satisfy count and length constraints.
- `.mcp.json` starts only the expected server.
- The installed cache copy works after the source checkout path is made unavailable.
- MCP initialize, list-tools, representative read tool, and graceful shutdown succeed.
- New plugin versions do not require hand-editing marketplace or Codex configuration.

### Browser and Dashboard Tests

- `get_dashboard_url({ open: false })` starts at most one server and never invokes the OS browser.
- The server listens only on an intended loopback address by default and does not print reusable credentials.
- A launch ticket is random, short-lived, single-use, project-scoped, removed from browser history after exchange, and rejected after replay or expiry.
- REST and Socket.IO calls reject missing, stale, cross-project, and malformed sessions without leaking sensitive details.
- The existing dashboard loads inside a Chromium viewport representative of the Codex right panel and at full desktop width.
- Live build, flash, task, approval, lock, serial, disconnect, reconnect, and monitor-health events render without a manual refresh.
- Reopening the dashboard reuses the active local server and, when host support permits, the current browser tab rather than producing duplicate windows.
- CLI/IDE and browser-disabled simulations return a usable link and complete the same workflows through MCP without claiming an in-app page opened.
- Background and scheduled task tests assert zero browser-opening calls.
- Playwright visual snapshots cover light/dark and key states; accessibility tests cover keyboard navigation, focus, names, status announcements, contrast, reduced motion, and narrow-panel reflow.
- Security tests cover CSP and related headers, origin/CORS rejection, referrer suppression, rate limits, request bounds, URL/log redaction, and malicious serial/project content.

### Skill Evaluation

For every skill, test:

- direct requests that should trigger it;
- paraphrased requests that should trigger it;
- incomplete requests that require one targeted question;
- neighboring requests that should trigger a different skill;
- malicious serial output that attempts to change instructions;
- ambiguous device and environment inputs;
- denied and approval-required policy responses;
- expected final summary, evidence, and next action.

### Monitoring and Automation Tests

- First healthy capture creates state and reports baseline.
- Second identical capture returns `changed: false`.
- New crash signature reports once with a redacted excerpt.
- Repeated identical crash increments a counter without duplicate noisy evidence.
- Recovery reports once and clears failure streak.
- Device disconnect, reconnect, port drift, and device replacement are distinct outcomes.
- Cursor expiry falls back safely without rereading an unbounded log.
- Overlapping runs serialize by automation key or return an explicit overlap result.
- Cancellation releases process, monitor lease, and hardware lock.
- A scheduled run under `read_only`, `build_only`, or `monitor_only` cannot flash.
- A lab-runner target-binding mismatch prevents flash even when the profile otherwise permits it.
- Paused or deleted automations leave no runaway monitor or task.
- Creating or running an automation never opens the dashboard or an external browser; its result may include a dashboard action for a later interactive review.

### Manual Codex Acceptance

1. Clone the repository into a new path.
2. Add or select the repo marketplace and install `platformio-mcp`.
3. Start a new Codex task and confirm the plugin's skills and MCP tools are available.
4. Run each starter prompt against a fixture project.
5. Ask to open the dashboard and confirm the existing UI appears in a right-side Codex browser panel without opening the OS-default browser.
6. Confirm the launch credential disappears from browser history, REST and Socket.IO stay authenticated, and reopening reuses the existing server/tab when supported.
7. Exercise project switching, live build/serial output, approval, task cancellation, disconnect/reconnect, light/dark mode, keyboard navigation, and narrow-panel reflow.
8. Repeat dashboard launch from a CLI/IDE or browser-disabled fixture and confirm the clickable-link/headless fallback is accurate.
9. Create a safe recurring serial-health monitor from chat.
10. Confirm a no-change run is quiet, inject a test failure, and confirm one alert and one recovery without any browser appearing during scheduled runs.
11. Attempt to schedule a flash under the default profile and confirm it is refused or remains approval-blocked.
12. Approve one interactive flash, verify monitor reattachment and runtime assertions, and inspect the audit record in the in-app dashboard.
13. Update the local plugin, reinstall through the supported cachebuster flow, and confirm a new task sees the update.

### Hardware Matrix

| Scenario                     | Minimum coverage                                                           |
| ---------------------------- | -------------------------------------------------------------------------- |
| ESP32 family                 | Build, approved flash, USB re-enumeration, serial assertion, crash pattern |
| RP2040 family                | Build, approved flash, monitor reconnect                                   |
| STM32 family                 | Build and upload method selection; monitor when supported                  |
| Arduino-class board          | Build, approved flash, simple boot marker                                  |
| No device attached           | Build-only success and explicit monitoring/flash blocker                   |
| Multiple devices attached    | Ambiguity response; no guessed write target                                |
| Simulator/native environment | Build and tests without requiring physical hardware                        |

## Release Gates

- No breaking changes to existing MCP tool names or the legacy Codex installer in the initial release.
- Canonical plugin validation passes from a clean checkout.
- Plugin cache copy is independent of the original clone path.
- Linux, Windows, and macOS launcher behavior is verified.
- All write tools have destructive annotations and server policy gates.
- Default and automation policy tests prove that agents cannot self-approve.
- Monitor/task cleanup tests show no leaked processes, ports, locks, or leases.
- The existing dashboard opens on request in Codex desktop's right-side browser panel, remains fully usable at narrow and full widths, and has a verified CLI/IDE fallback.
- Dashboard sessions are loopback-only by default, short-lived, replay-resistant, absent from logs/history after exchange, and covered by security tests.
- Serial/build logs and screenshots pass secret scans.
- Skill activation tests meet agreed precision and recall thresholds.
- Hardware E2E evidence exists for at least one supported physical board before release.
- Installation, update, uninstall, and rollback are documented.

## Rollback Strategy

- Keep the MCP-only installer operational throughout rollout.
- Make plugin installation additive and reversible; disabling or uninstalling the plugin must not delete project state or PlatformIO projects.
- Keep automation state under the project workspace so it can be inspected and removed independently of plugin cache data.
- Version the plugin with the npm package and retain the previous release artifact and marketplace ref.
- If the bundled runtime fails on one platform, switch that platform to the pinned npm launcher while retaining the same tool contracts.
- If automation behavior is noisy or unsafe, disable the automation skill and `lab_runner` profile without removing interactive build, flash, or monitor tools.

## Definition of Done

The work is complete when:

- the repo contains a valid installable `platformio-mcp` plugin and repo marketplace;
- a fresh clone offers the plugin through documented Codex flows;
- the plugin exposes all existing PlatformIO MCP functionality and focused workflow skills;
- build, flash, filesystem upload, monitor, diagnostics, locks, libraries, dashboard, policy, and agent workflows remain functional and represented in the generated traceability report;
- an interactive request opens the existing authenticated dashboard in Codex desktop's in-app browser panel, while CLI/IDE clients receive an honest link/headless fallback and scheduled runs remain UI-free;
- monitoring is bounded, incremental, change-aware, cancellable, and safe for scheduled runs;
- automation creation is skill-guided and uses Codex's scheduler rather than an ad hoc daemon;
- unattended flashing is denied by default and tightly constrained when explicitly enabled for a lab;
- plugin, skill, MCP contract, policy, cross-platform, and hardware tests pass;
- release and rollback documentation is complete.

## References

- [OpenAI plugin architecture](https://developers.openai.com/plugins/concepts/plugins)
- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [OpenAI skill building](https://developers.openai.com/plugins/build/skills)
- [Codex in-app browser](https://learn.chatgpt.com/docs/browser)
- [OpenAI MCP plugin UI](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Codex scheduled tasks](https://learn.chatgpt.com/docs/automations)
- [PlatformIO MCP command reference](MCPServerCommandReference.md)
- [PlatformIO MCP Codex guide](CODEX.md)
