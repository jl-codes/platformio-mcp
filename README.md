<p align="center">
  <img src="docs/assets/pio_mcp_220x220.png" alt="PlatformIO MCP" width="220"/>
</p>

# PlatformIO MCP

PlatformIO MCP is the open-source, agent-first hardware execution layer for embedded development.

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

All risky operations still honor policy and approval rules.

## Quick Start

### 1. Run the dashboard

```bash
npx platformio-mcp dashboard
```

### 2. Use the CLI

```bash
npx platformio-mcp devices
npx platformio-mcp boards --filter esp32
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

PlatformIO MCP enforces policy decisions across CLI and MCP flows.

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
- `flash_requires_approval`
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
- [PIO MCP Design Specification](docs/PIOMCPDesignSpecification.md)
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
- `.github/workflows/hardware-e2e.yml` is a manual self-hosted runner workflow for real hardware MCP E2E (`RUN_MCP_E2E=1`).

## Contributing

Contributions are welcome.

- Open an issue for bugs or feature requests
- Submit a pull request with tests when applicable

## License

MIT. See [LICENSE](LICENSE).
