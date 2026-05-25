export type PolicyDecisionStatus = "allow" | "deny" | "requires_approval";

export type PolicyRiskLevel = "low" | "medium" | "high" | "critical";

export interface PolicyDecision {
  status: PolicyDecisionStatus;
  reason: string;
  action: string;
  riskLevel: PolicyRiskLevel;
  approvalId?: string;
  timestamp: string;
}

export interface PolicyConfig {
  approval_required: string[];
  allow: string[];
  deny: string[];
  require_workspace_boundary: boolean;
  require_device_lock_for_upload: boolean;
  redact_secrets_from_logs: boolean;
  audit_all_agent_actions: boolean;
}

export type PolicyProfileName =
  | "read_only"
  | "build_only"
  | "flash_requires_approval"
  | "lab_admin";

export interface PolicyProfileConfig {
  profile: PolicyProfileName;
  overrides?: Partial<PolicyConfig>;
}

export interface ApprovalRequest {
  id: string;
  action: string;
  riskLevel: PolicyRiskLevel;
  reason: string;
  requestedBy: "agent" | "user" | "system";
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  action: string;
  status:
    | "allowed"
    | "denied"
    | "requires_approval"
    | "approved"
    | "failed"
    | "completed";
  reason?: string;
  riskLevel: PolicyRiskLevel;
  workspaceDir?: string;
  devicePort?: string;
  taskId?: string;
  approvalId?: string;
  timestamp: string;
}

export interface PolicyEvaluationContext {
  workspaceDir?: string;
  devicePort?: string;
  taskId?: string;
  actor?: "agent" | "user" | "system";
}
