import type { PolicyConfig, PolicyRiskLevel } from "./types.js";

export const actionRiskLevels: Record<string, PolicyRiskLevel> = {
  list_devices: "low",
  list_boards: "low",
  get_board_info: "low",
  get_project_config: "low",
  build_project: "low",
  check_project: "low",
  query_logs: "low",

  start_monitor: "medium",
  stop_monitor: "medium",
  install_library: "medium",
  update_library: "medium",
  clean_project: "medium",

  upload_firmware: "high",
  upload_filesystem: "high",
  reset_server_state: "high",

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
    "build_project",
    "check_project",
    "query_logs",
    "start_monitor",
    "stop_monitor",
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

