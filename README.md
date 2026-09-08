<p align="center">
  <img src="docs/assets/pio_agent.png" alt="PIO Agent" width="240"/>
</p>

# PIO Agent

PIO Agent is the open-source, agent-first hardware execution layer for embedded development, built on the PlatformIO MCP runtime.

## Brand and Compatibility

**PIO Agent** is the product and Codex Plugin name. **PlatformIO MCP** is the underlying MCP runtime and the compatibility identity used by existing installations. The Codex plugin ID, marketplace ID, configuration keys, and skill namespace remain `platformio-mcp`. On npm, `platformio-mcp` is the canonical package while `pio-mcp` and `pio-agent` are thin compatibility packages that delegate to it. The canonical package also installs both `platformio-mcp` and `pio-agent` executable names. This lets existing consumers upgrade without migration while new users see PIO Agent throughout the interface.

It exposes PlatformIO workflows for board discovery, project setup, build, flash, monitor, diagnostics, and task orchestration through:
- an MCP server adapter
- a first-class CLI adapter (`platformio-mcp` / `pio-agent`)
- an optional local dashboard for visibility and control

MCP is one adapter. PlatformIO is the first backend.

## Agent-First Capabilities

- Project readiness validation (`agent_validate_project`)
- Rich build diagnostics with structured error taxonomy (`agent_build_diagnose`)
- Board-aware GPIO safety audits (`agent_safe_pin_audit`)
- Flash + monitor + runtime assertions (`agent_flash_monitor_verify`)
- Persistent workflow artifacts in `.pio-mcp-workspace/` (`lastAgentReport.json`, `boardReport.json`)
- Board intelligence reports (`agent_generate_board_report`)
- Policy profile introspection (`get_policy_status`)
- Exact project/environment/device bindings (`agent_resolve_target`)
- Bounded, cursor-based serial health checks (`agent_monitor_health`)
- Idempotent task cancellation and compact history (`cancel_task`, `list_task_history`)
- Read-only approval status for agents; approval remains human-controlled

All risky operations still honor policy and approval rules.

## Quick Start

### 1. Run the dashboard

```bash
npx platformio-mcp dashboard
```

### 2. Use the CLI

All three npm names are supported. `platformio-mcp` is canonical; `pio-mcp` and `pio-agent` install the same CLI through thin dependency-only aliases:

```bash
npx platformio-mcp --help
npx pio-mcp --help
npx pio-agent --help
```

```bash
npx --package platformio-mcp pio-agent devices
npx --package platformio-mcp pio-agent boards --filter esp32
npx platformio-mcp init --board esp32dev --framework arduino --project-dir ./firmware
npx platformio-mcp build --project-dir ./firmware
npx platformio-mcp flash --project-dir ./firmware --port auto
npx platformio-mcp monitor --project-dir ./firmware --port auto --expect BOOT_OK --timeout 30
npx platformio-mcp agent-validate --project-dir ./firmware
npx platformio-mcp agent-build-diagnose --project-dir ./firmware
npx platformio-mcp agent-safe-pin-audit --project-dir ./firmware --board esp32dev
npx platformio-mcp agent-flash-monitor-verify --project-dir ./firmware --expect-all BOOT_OK --reject-patterns "Guru Meditation,Brownout detector,WDT reset" --timeout 45
npx platformio-mcp agent-last-report --project-dir ./firmware
npx platformio-mcp policy-status --project-dir ./firmware
npx platformio-mcp task-status <task-id>
```

Use `--json` for machine-readable output:

```bash
npx platformio-mcp build --project-dir ./firmware --json
```

### 3. Install into AI hosts

```bash
npx platformio-mcp install --cline
npx platformio-mcp install --claude
npx platformio-mcp install --vscode
npx platformio-mcp install --antigravity
npx platformio-mcp install --codex
```

### 4. Install the full Codex Plugin

The PIO Agent Codex Plugin adds the bundled MCP runtime, focused embedded skills, secure in-app dashboard flow, and monitoring-automation guidance. Codex requires one stable plugin identifier, so install selectors and skill namespaces remain `platformio-mcp`; the installed product is shown as PIO Agent. From a clone:

```bash
npm install
npm --prefix web install
npm run plugin:build
node build/cli.js install --codex-plugin
```

From npm:

```bash
npx -y platformio-mcp install --codex-plugin
```

Start a new Codex task after installation. The legacy `install --codex` command remains available for MCP-only configuration. See the [full Codex Plugin guide](docs/CODEX.md) for update, uninstall, browser fallback, policy, automation, and rollback details.

The plugin release gates run on Windows, macOS, and Linux, exercise the authenticated dashboard in Chromium, validate the bundled runtime and 42-tool registry, and keep physical-board evidence in a separate manual workflow. That workflow uploads only bounded, sanitized evidence; raw hardware logs stay on the self-hosted runner. See the [release and validation guide](docs/CODEX_PLUGIN_RELEASE.md).

For headless verification and status inspection, the same CLI also provides `plugin validate`, `target-resolve`, `monitor-status`, `monitor-health`, `task-history`, `approval-status`, and `pending-approvals`. Run `platformio-mcp --help` for bounded options and JSON output support.

## Manual MCP Config

```json
{
  "mcpServers": {
    "platformio": {
      "command": "npx",
      "args": ["-y", "platformio-mcp", "--open-dashboard-on-start"]
    }
  }
}
```

On Windows, use `npx.cmd` if your host requires explicit shim resolution.

## Core Capabilities

- Board and device discovery for PlatformIO-supported hardware
- Project initialization and config inspection
- Build, upload, monitor, and background task polling
- Structured diagnostics for build/upload/serial failures
- Safety and policy guardrails (approval gates, audit logs, redaction)
- Dashboard visibility for commands, logs, locks, and safety state

## Safety Model

PIO Agent enforces policy decisions across CLI and MCP flows.

- Actions can be `allow`, `deny`, or `requires_approval`
- Risky operations (for example firmware upload/reset paths) require explicit approval
- All actions can be audited
- Secrets are redacted in exposed log streams

Policy profiles can be selected per-project via `.pio-mcp-policy.json`:

```json
{
  "profile": "flash_requires_approval"
}
```

Supported profiles:
- `read_only`
- `build_only`
- `monitor_only`
- `flash_requires_approval`
- `lab_runner` (explicit, expiring unattended-lab policy required)
- `lab_admin`

CLI approval workflows:

```bash
npx platformio-mcp approvals --status pending --json
npx platformio-mcp approve <approval-id> --json
npx platformio-mcp deny <approval-id> --json
```

## Codex Usage

Codex-facing docs and prompt cookbook:

- [Codex Usage Guide](docs/CODEX.md)
- [Codex Prompt Cookbook](docs/CODEX_PROMPT_COOKBOOK.md)

## Documentation

Getting started:
- [LLM Installation Guide](docs/LLMInstallationGuide.md)

Guides and references:
- [Agent Customization Guide](docs/reference/AgentCustomizationGuide.md)
- [MCP Server Command Reference](docs/MCPServerCommandReference.md)
- [Troubleshooting Guide](docs/TroubleshootingGuide.md)
- [Agent-First Embedded Workflow](docs/AGENT_FIRST_EMBEDDED.md)
- [Competitive Positioning](docs/COMPETITIVE_POSITIONING.md)
- [MCP-U Integration Template](docs/MCP_U_INTEGRATION.md)
- [Agent Skills Directory](.skills/README.md)

Specifications:
- [PIO Agent Design Specification](docs/PIOMCPDesignSpecification.md)
- [Web UX Design Specification](docs/WebUXDesignSpecification.md)
- [Development Guide](docs/reference/DevelopmentGuide.md)

## Development

Prerequisites:
- Node.js >= 18
- PlatformIO Core CLI ([install guide](https://platformio.org/install/cli))

Local setup:

```bash
git clone https://github.com/jl-codes/platformio-mcp.git
cd platformio-mcp
npm install
npm run build
npm run test
npm run smoke-test
```

CI/CD test tiers:

- `npm run test:ci:unit` runs unit/component coverage used in cross-platform CI.
- `npm run test:e2e:ci` runs CI-safe end-to-end tests for agent workflows and CLI wiring.
- `.github/workflows/ci.yml` runs typecheck, tests, and package smoke checks on pull requests/pushes.
- `.github/workflows/hardware-e2e.yml` is a manual self-hosted-runner workflow for one explicitly confirmed physical-board write, bundled-plugin protocol checks, post-flash identity/serial assertions, cleanup proof, and sanitized evidence.

## Contributing

Contributions are welcome.

- Open an issue for bugs or feature requests
- Submit a pull request with tests when applicable

## License

MIT. See [LICENSE](LICENSE).
