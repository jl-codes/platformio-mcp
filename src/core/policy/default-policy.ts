import type { PolicyConfig, PolicyRiskLevel } from "./types.js";

export const actionRiskLevels: Record<string, PolicyRiskLevel> = {
  list_devices: "low",
  list_boards: "low",
  get_board_info: "low",
  get_project_config: "low",
  get_policy_status: "low",
  build_project: "low",
  check_project: "low",
  query_logs: "low",
  agent_validate_project: "low",
  agent_build_diagnose: "low",
  agent_safe_pin_audit: "low",
  agent_get_last_report: "low",
  agent_generate_board_report: "low",

  start_monitor: "medium",
  stop_monitor: "medium",
  install_library: "medium",
  update_library: "medium",
  clean_project: "medium",

  upload_firmware: "high",
  upload_filesystem: "high",
  reset_server_state: "high",
  agent_flash_monitor_verify: "high",

  erase_flash: "critical",
  run_shell_command: "critical",
  ssh_deploy: "critical",
};

export const deniedActionPatterns = [
  /erase_disk/i,
  /format_drive/i,
  /modify_system_usb_permissions_without_approval/i,
  /curl_pipe_to_shell/i,
  /delete_home_directory/i,
  /run_unbounded_shell_loop/i,
];

export const defaultPolicy: PolicyConfig = {
  approval_required: [
    "upload_firmware",
    "upload_filesystem",
    "agent_flash_monitor_verify",
    "erase_flash",
    "reset_server_state",
    "run_shell_command",
    "ssh_deploy",
  ],
  allow: [
    "list_devices",
    "list_boards",
    "get_board_info",
    "get_project_config",
    "get_policy_status",
    "build_project",
    "check_project",
    "query_logs",
    "start_monitor",
    "stop_monitor",
    "agent_validate_project",
    "agent_build_diagnose",
    "agent_safe_pin_audit",
    "agent_get_last_report",
    "agent_generate_board_report",
  ],
  deny: [
    "erase_disk",
    "format_drive",
    "modify_system_usb_permissions_without_approval",
    "curl_pipe_to_shell",
    "delete_home_directory",
    "run_unbounded_shell_loop",
  ],
  require_workspace_boundary: true,
  require_device_lock_for_upload: true,
  redact_secrets_from_logs: true,
  audit_all_agent_actions: true,
};
