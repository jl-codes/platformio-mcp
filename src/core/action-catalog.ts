/**
 * Shared action identity and safety catalog.
 * Provides MCP_ACTIONS, actionRiskLevels and policyActionForCliCommand.
 * This catalog contains implemented legacy actions only, never planned tools.
 */
import type { PolicyRiskLevel } from "./policy/types.js";

/** Shared policy and side-effect metadata for one implemented action. */
export interface ActionSafetyMetadata {
  policyAction?: string;
  riskLevel: PolicyRiskLevel;
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
  openWorld: boolean;
}

const READ: ActionSafetyMetadata = {
  riskLevel: "low",
  readOnly: true,
  destructive: false,
  idempotent: true,
  openWorld: false,
};

/** Existing callable MCP actions; additions require matching registered handlers. */
export const MCP_ACTIONS: Record<string, ActionSafetyMetadata> = {
  decode_backtrace: {
    policyAction: "build_project",
    riskLevel: "medium",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
  },
  size_report: {
    policyAction: "build_project",
    riskLevel: "medium",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
  },
  list_boards: READ,
  get_board_info: READ,
  list_devices: READ,
  init_project: {
    riskLevel: "medium",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
  },
  build_project: {
    riskLevel: "low",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
  },
  clean_project: {
    riskLevel: "medium",
    readOnly: false,
    destructive: true,
    idempotent: true,
    openWorld: false,
  },
  upload_filesystem: {
    riskLevel: "high",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
  },
  upload_firmware: {
    riskLevel: "high",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
  },
  acquire_lock: {
    riskLevel: "low",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: false,
  },
  release_lock: {
    riskLevel: "low",
    readOnly: false,
    destructive: false,
    idempotent: true,
    openWorld: false,
  },
  get_lock_status: READ,
  search_libraries: { ...READ, openWorld: true },
  install_library: {
    riskLevel: "medium",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
  },
  list_installed_libraries: READ,
  start_monitor: {
    riskLevel: "medium",
    readOnly: false,
    destructive: false,
    idempotent: true,
    openWorld: false,
  },
  stop_monitor: {
    riskLevel: "medium",
    readOnly: false,
    destructive: false,
    idempotent: true,
    openWorld: false,
  },
  query_logs: READ,
  reset_server_state: {
    riskLevel: "high",
    readOnly: false,
    destructive: true,
    idempotent: true,
    openWorld: false,
  },
  check_task_status: { ...READ, policyAction: "query_logs" },
  get_dashboard_url: { ...READ, policyAction: "query_logs" },
  get_project_context: READ,
  get_project_config: READ,
  agent_validate_project: READ,
  agent_build_diagnose: {
    riskLevel: "low",
    policyAction: "build_project",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
  },
  agent_safe_pin_audit: READ,
  agent_flash_monitor_verify: {
    riskLevel: "high",
    policyAction: "upload_firmware",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
  },
  agent_get_last_report: READ,
  agent_generate_board_report: READ,
  get_policy_status: READ,
  agent_resolve_target: READ,
  get_monitor_status: READ,
  capture_serial_window: {
    riskLevel: "medium",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: false,
  },
  agent_monitor_health: {
    riskLevel: "medium",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: false,
  },
  cancel_task: {
    riskLevel: "medium",
    readOnly: false,
    destructive: true,
    idempotent: true,
    openWorld: false,
  },
  list_task_history: READ,
  get_approval_request: READ,
  list_pending_approvals: READ,
  system_info: READ,
  check_project: {
    riskLevel: "low",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
  },
  run_tests: {
    riskLevel: "high",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
  },
  uninstall_library: {
    riskLevel: "medium",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: true,
  },
  update_library: {
    riskLevel: "medium",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: true,
  },
};

/** Risks for implemented actions plus reserved privileged operations. */
export const actionRiskLevels: Record<string, PolicyRiskLevel> = {
  ...Object.fromEntries(
    Object.entries(MCP_ACTIONS).map(([name, action]) => [
      name,
      action.riskLevel,
    ]),
  ),
  erase_flash: "critical",
  run_shell_command: "critical",
  ssh_deploy: "critical",
};

/** Resolves the existing CLI spelling to its concrete operation. */
export function operationForCliCommand(command: string): string {
  switch (command) {
    case "decode-backtrace":
      return "decode_backtrace";
    case "size-report":
      return "size_report";
    case "devices":
      return "list_devices";
    case "boards":
      return "list_boards";
    case "init":
      return "init_project";
    case "build":
      return "build_project";
    case "flash":
      return "upload_firmware";
    case "monitor":
      return "start_monitor";
    case "target-resolve":
      return "agent_resolve_target";
    case "monitor-status":
      return "get_monitor_status";
    case "monitor-health":
      return "agent_monitor_health";
    case "task-status":
      return "check_task_status";
    case "task-history":
      return "list_task_history";
    case "agent-validate":
      return "agent_validate_project";
    case "agent-build-diagnose":
      return "agent_build_diagnose";
    case "agent-safe-pin-audit":
      return "agent_safe_pin_audit";
    case "agent-flash-monitor-verify":
      return "agent_flash_monitor_verify";
    case "agent-last-report":
      return "agent_get_last_report";
    case "agent-board-report":
      return "agent_generate_board_report";
    case "policy-status":
      return "get_policy_status";
    case "dashboard":
      return "get_dashboard_url";
    case "plugin":
      return "get_policy_status";
    case "install":
      return "run_shell_command";
    case "approval-status":
      return "get_approval_request";
    case "pending-approvals":
      return "list_pending_approvals";
    case "approvals":
    case "approve":
    case "deny":
      return "query_logs";
    default:
      return command;
  }
}

/** Resolves CLI names through the same permission mapping as the MCP registry. */
export function policyActionForCliCommand(command: string): string {
  const name = operationForCliCommand(command);
  return MCP_ACTIONS[name]?.policyAction ?? name;
}
