# Agent-First Embedded Workflow

PlatformIO-MCP is designed around the physical embedded feedback loop:

1. Discover hardware and board capabilities
2. Plan changes with project and policy context
3. Build firmware
4. Diagnose failures with structured taxonomy
5. Approve risky operations (when policy requires it)
6. Flash firmware
7. Monitor serial runtime output
8. Verify runtime assertions
9. Persist and retrieve reports

## Why This Matters

Embedded systems are not purely virtual. Each step interacts with real hardware constraints:
- serial ports are exclusive resources
- boards can brown out, watchdog reset, or boot-loop
- wrong board/framework/pin choices can fail before runtime

PlatformIO-MCP makes that loop explicit and machine-usable with typed tool responses, spool logs, policy enforcement, and persistent artifacts.

## How PlatformIO-MCP Implements It

- `agent_validate_project` for project readiness and next steps
- `agent_build_diagnose` for taxonomy-based build outcomes
- `agent_safe_pin_audit` for board-aware GPIO risk screening
- `agent_flash_monitor_verify` for flash + runtime verification in one workflow
- `agent_get_last_report` and `agent_generate_board_report` for stateful recall
- `get_policy_status` for profile-level safety visibility

## Open vs. Closed Approaches

Closed tools can provide convenient abstractions, but often hide internal state transitions and policy details. PlatformIO-MCP intentionally exposes:
- command-level structure
- diagnostic evidence and recommended actions
- policy decisions and approval states
- on-disk logs and artifacts

This keeps workflows inspectable, auditable, and extensible for different teams, boards, and agent runtimes.
