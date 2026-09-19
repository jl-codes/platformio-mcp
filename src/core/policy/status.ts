/**
 * Policy Status Helper
 *
 * Provides:
 * - getPolicyStatus: Returns the active policy profile and effective permissions.
 */

import type { PolicyStatusResult } from "../../types.js";
import { loadEffectivePolicyState } from "./load-policy.js";
import { PolicyConfigError } from "./policy-schema.js";

/**
 * Returns the active policy profile and effective action gates.
 *
 * @param workspaceDir - Optional project directory for local profile resolution.
 * @returns Effective policy status payload.
 */
export function getPolicyStatus(workspaceDir?: string): PolicyStatusResult {
  const hostPolicy = {
    enforcement: "external" as const,
    effectivePermissions: "unknown" as const,
    message:
      "Your MCP host enforces its own resolved permissions. PlatformIO policy status does not read or verify those runtime grants.",
  };
  let state;
  try {
    state = loadEffectivePolicyState(workspaceDir);
  } catch (error) {
    if (!(error instanceof PolicyConfigError)) throw error;
    return {
      valid: false,
      serverPolicy: { enforcement: "platformio-mcp", valid: false },
      hostPolicy,
      error: { code: "POLICY_CONFIG_INVALID", message: error.message },
      profile: "invalid",
      source: error.source,
      sources: [],
      allowedOperations: ["get_policy_status"],
      approvalRequiredOperations: [],
      deniedOperations: [],
      requireWorkspaceBoundary: true,
      requireDeviceLockForUpload: true,
      redactSecretsFromLogs: true,
      auditAllAgentActions: true,
    };
  }
  return {
    valid: true,
    serverPolicy: {
      enforcement: "platformio-mcp",
      valid: true,
      digest: state.digest,
    },
    hostPolicy,
    sources: state.sources,
    digest: state.digest,
    projectEnrollment: state.projectEnrollment,
    profile: state.profile,
    source: state.source,
    allowedOperations: state.policy.allow,
    approvalRequiredOperations: state.policy.approval_required,
    deniedOperations: state.policy.deny,
    requireWorkspaceBoundary: state.policy.require_workspace_boundary,
    requireDeviceLockForUpload: state.policy.require_device_lock_for_upload,
    redactSecretsFromLogs: state.policy.redact_secrets_from_logs,
    auditAllAgentActions: state.policy.audit_all_agent_actions,
  };
}
