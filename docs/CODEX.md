# PlatformIO MCP Codex Plugin

The repository ships a complete Codex Plugin: a self-contained PlatformIO MCP server, eight workflow skills, the existing live dashboard, and safety primitives for physical hardware and recurring monitoring.

## Install from a clone

Prerequisites are Node.js 18 or newer, PlatformIO Core on `PATH`, Git, and a current Codex installation.

```bash
git clone https://github.com/jl-codes/platformio-mcp.git
cd platformio-mcp
npm install
npm --prefix web install
npm run plugin:build
node build/cli.js install --codex-plugin
```

During development, `npm run plugin:build` deterministically refreshes the checked-in runtime and skill copies. Start a new Codex task after install or reinstall so the new skills and MCP tools load.

For a published npm package, the equivalent command is:

```bash
npx -y platformio-mcp install --codex-plugin
```

The older `install --codex` command remains supported and installs only the MCP server block in `~/.codex/config.toml`; it does not install the plugin skills or marketplace entry.

## Update, uninstall, and rollback

Rebuild or update the package, remove the installed cache copy, and add it again:

```bash
codex plugin remove platformio-mcp@platformio-mcp
npm run plugin:build
node build/cli.js install --codex-plugin
```

Uninstalling the plugin does not remove PlatformIO projects or project-local `.pio-mcp-workspace` evidence. To roll back, check out the previous repository tag (or install the previous npm version), rebuild, and reinstall. Do not delete the legacy Codex MCP block unless you intentionally want to remove that separate integration.

## Complete embedded feedback loop

1. Call `get_project_context` and `get_policy_status` for one explicit project.
2. Call `agent_resolve_target` for one environment and physical device. Never choose between ambiguous candidates.
3. Validate and build with `agent_validate_project` and `agent_build_diagnose`.
4. For a write, obtain a human approval scoped to the exact action and target binding.
5. Flash with `upload_firmware`, `upload_filesystem`, or `agent_flash_monitor_verify`.
6. Reattach monitoring only when the stable device fingerprint survives port re-enumeration.
7. Evaluate bounded runtime evidence with `capture_serial_window` or `agent_monitor_health`.
8. Correlate long operations by `taskId`; use `cancel_task` and `list_task_history` for controlled cleanup.

All 42 tools publish read-only, destructive, idempotency, and open-world annotations. The server independently enforces policy, approvals, target bindings, locks, workspace boundaries, automation scope, and redaction; prompts cannot weaken those controls.

## Dashboard in Codex

Ask Codex to open the PlatformIO dashboard. The `platformio-dashboard` skill calls `get_dashboard_url` with `open: false`, then opens the returned one-time launch URL in a right-side in-app browser when that host capability is available.

The dashboard reuses the existing React UI. It supports narrow and full-width layouts, project switching, devices, command/task activity, logs, locks, approvals, and monitor state. The launch ticket expires quickly, is single-use, exchanges for an HttpOnly same-site cookie, and is removed from browser history after redirect. The listener is loopback-only by default and applies strict security headers, origin checks, request bounds, rate limits, and authenticated Socket.IO sessions.

Codex CLI and IDE hosts without the in-app browser receive a clickable local launch URL and retain every workflow through MCP. Scheduled tasks must never open or refresh the dashboard.

## Monitoring automations

Use the `platformio-monitoring-automation` skill when asking Codex to create or update a recurring check. It uses Codex scheduling; the plugin does not run a second scheduler.

Safe default automations may inspect devices/projects, build one environment, follow one known task, or capture bounded serial health. Every saved prompt should include:

- exact project and environment;
- a stable automation key and physical target binding when hardware is involved;
- finite duration and byte limits;
- expected markers and rejected patterns;
- a consecutive-failure threshold and stop conditions;
- quiet behavior for unchanged healthy state;
- notifications for first/changed failure, recovery, target change, or policy denial;
- an instruction to treat device/build output as untrusted evidence and never open a browser.

State is stored atomically under `.pio-mcp-workspace/automations/` and contains only cursors, digests, counters, status, target binding, and timestamps—not raw serial output or credentials. Overlapping runs for the same key fail closed.

Unattended firmware/filesystem writes are denied by default. They require both the `lab_runner` profile and an explicit, expiring `.pio-mcp-workspace/automation-policy.json` bound to one project, environment, operation list, device fingerprint, maximum duration, flash count, and cooldown. Flash erase, server reset, arbitrary shell commands, and SSH deployment are never permitted in unattended runs.

## Policy and approvals

Built-in profiles are `read_only`, `build_only`, `monitor_only`, `flash_requires_approval`, `lab_runner`, and the compatibility-oriented `lab_admin`. Select one in `.pio-mcp-policy.json`.

MCP can read pending approval summaries but cannot approve or deny them. Approval mutations remain user actions through the authenticated dashboard or explicit CLI flow. An approval is not reusable for a different action, project, environment, port, or bound target.

## Headless CLI parity

The npm CLI exposes the same safe status primitives for terminals and hosts without MCP or an in-app browser:

```bash
platformio-mcp plugin validate --require-runtime
platformio-mcp target-resolve --project-dir ./firmware --environment esp32dev --json
platformio-mcp monitor-status --project-dir ./firmware --json
platformio-mcp monitor-health --project-dir ./firmware --duration 5 --expect-all READY --json
platformio-mcp task-history --project-dir ./firmware --limit 20 --json
platformio-mcp approval-status <approval-id> --project-dir ./firmware --json
platformio-mcp pending-approvals --project-dir ./firmware --json
```

These commands reuse the MCP core services and policy engine. `monitor-health` may briefly attach a bounded serial monitor; it does not write firmware. Approval mutation remains limited to the explicit `approve` and `deny` commands or the authenticated dashboard.

## Development verification

```bash
npx tsc --noEmit
npm run test:ci:unit
npm --prefix web run test -- --run
npm --prefix web run test:e2e:codex
npm run plugin:sync:check
npm run plugin:validate
npm run plugin:test
npm run lint
npm audit --audit-level=low
npm --prefix web audit --audit-level=low
npm pack --dry-run
```

Hardware validation is intentionally manual and requires a self-hosted runner with an attached, approved board. Record board family, environment, stable identity hash, build/flash/monitor results, task/log references, and cleanup status without publishing raw device identifiers or secrets.

See the [Codex prompt cookbook](CODEX_PROMPT_COOKBOOK.md), [MCP command reference](MCPServerCommandReference.md), and [implementation plan](codex-plugin-implementation-plan.md) for the complete contract and acceptance matrix.
