/**
 * Policy Profile Definitions
 *
 * Provides:
 * - policyProfiles: Built-in policy profile templates.
 * - resolvePolicyProfile: Resolves a profile by name.
 */

import type {
  PolicyConfig,
  PolicyProfileConfig,
  PolicyProfileName,
} from "./types.js";
import { defaultPolicy } from "./default-policy.js";

const READ_ONLY_ALLOW = [
  "list_devices",
  "list_boards",
  "get_board_info",
  "get_project_config",
  "get_project_context",
  "query_logs",
  "check_task_status",
  "system_info",
  "agent_validate_project",
  "agent_safe_pin_audit",
  "agent_get_last_report",
  "agent_generate_board_report",
  "get_policy_status",
];

const BUILD_ONLY_ALLOW = [
  ...READ_ONLY_ALLOW,
  "build_project",
  "check_project",
  "run_tests",
  "agent_build_diagnose",
];

/**
 * Built-in policy profile templates.
 */
export const policyProfiles: Record<PolicyProfileName, PolicyConfig> = {
  read_only: {
    ...defaultPolicy,
    allow: READ_ONLY_ALLOW,
    approval_required: [],
    deny: Array.from(
      new Set([
        ...defaultPolicy.deny,
        "build_project",
        "check_project",
        "run_tests",
        "upload_firmware",
        "upload_filesystem",
        "clean_project",
        "reset_server_state",
        "agent_build_diagnose",
        "agent_flash_monitor_verify",
      ]),
    ),
  },
  build_only: {
    ...defaultPolicy,
    allow: BUILD_ONLY_ALLOW,
    approval_required: [],
    deny: Array.from(
      new Set([
        ...defaultPolicy.deny,
        "upload_firmware",
        "upload_filesystem",
        "reset_server_state",
        "agent_flash_monitor_verify",
      ]),
    ),
  },
  flash_requires_approval: {
    ...defaultPolicy,
    allow: Array.from(
      new Set([
        ...defaultPolicy.allow,
        "clean_project",
        "run_tests",
        "agent_validate_project",
        "agent_build_diagnose",
        "agent_safe_pin_audit",
        "agent_flash_monitor_verify",
        "agent_get_last_report",
        "agent_generate_board_report",
        "get_policy_status",
      ]),
    ),
    approval_required: Array.from(
      new Set([
        ...defaultPolicy.approval_required,
        "agent_flash_monitor_verify",
      ]),
    ),
  },
  lab_admin: {
    ...defaultPolicy,
    allow: Array.from(
      new Set([
        ...defaultPolicy.allow,
        "clean_project",
        "run_tests",
        "reset_server_state",
        "upload_firmware",
        "upload_filesystem",
        "agent_validate_project",
        "agent_build_diagnose",
        "agent_safe_pin_audit",
        "agent_flash_monitor_verify",
        "agent_get_last_report",
        "agent_generate_board_report",
        "get_policy_status",
      ]),
    ),
    approval_required: [],
    deny: defaultPolicy.deny,
  },
};

/**
 * Resolves a built-in policy profile with optional inline overrides.
 *
 * @param config - Profile configuration entry.
 * @returns Effective policy config for the selected profile.
 */
export function resolvePolicyProfile(config: PolicyProfileConfig): PolicyConfig {
  const base = policyProfiles[config.profile] ?? policyProfiles.flash_requires_approval;
  if (!config.overrides) return base;
  return {
    approval_required: config.overrides.approval_required ?? base.approval_required,
    allow: config.overrides.allow ?? base.allow,
    deny: config.overrides.deny ?? base.deny,
    require_workspace_boundary:
      config.overrides.require_workspace_boundary ?? base.require_workspace_boundary,
    require_device_lock_for_upload:
      config.overrides.require_device_lock_for_upload ?? base.require_device_lock_for_upload,
    redact_secrets_from_logs:
      config.overrides.redact_secrets_from_logs ?? base.redact_secrets_from_logs,
    audit_all_agent_actions:
      config.overrides.audit_all_agent_actions ?? base.audit_all_agent_actions,
  };
}
