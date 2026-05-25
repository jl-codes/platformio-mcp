/**
 * Policy Status Helper
 *
 * Provides:
 * - getPolicyStatus: Returns the active policy profile and effective permissions.
 */

import type { PolicyStatusResult } from "../../types.js";
import { loadEffectivePolicyState } from "./load-policy.js";

/**
 * Returns the active policy profile and effective action gates.
 *
 * @param workspaceDir - Optional project directory for local profile resolution.
 * @returns Effective policy status payload.
 */
export function getPolicyStatus(workspaceDir?: string): PolicyStatusResult {
  const state = loadEffectivePolicyState(workspaceDir);
  return {
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
