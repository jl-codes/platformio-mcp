import path from "node:path";
import { actionRiskLevels, defaultPolicy, deniedActionPatterns } from "./default-policy.js";
import { createApprovalRequest, getApproval } from "./approvals.js";
import { appendAuditEvent } from "./audit-log.js";
import { loadEffectivePolicy } from "./load-policy.js";
import type {
  PolicyDecision,
  PolicyEvaluationContext,
  PolicyRiskLevel,
} from "./types.js";

function nowIso() {
  return new Date().toISOString();
}

function normalizeActionName(action: string): string {
  return action.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
}

function riskForAction(action: string): PolicyRiskLevel {
  return actionRiskLevels[action] ?? "medium";
}

function hasProjectDir(args: Record<string, unknown>) {
  return typeof args.projectDir === "string" && args.projectDir.length > 0;
}

function isPathBoundaryUnsafe(projectDir: string): boolean {
  const resolved = path.resolve(projectDir);
  const root = path.parse(resolved).root;
  return resolved === root;
}

function decision(
  status: PolicyDecision["status"],
  reason: string,
  action: string,
  riskLevel: PolicyRiskLevel,
  approvalId?: string,
): PolicyDecision {
  return {
    status,
    reason,
    action,
    riskLevel,
    approvalId,
    timestamp: nowIso(),
  };
}

export async function evaluatePolicy(
  actionName: string,
  args: Record<string, unknown>,
  context: PolicyEvaluationContext = {},
): Promise<PolicyDecision> {
  const action = normalizeActionName(actionName);
  const riskLevel = riskForAction(action);
  const policy = loadEffectivePolicy(context.workspaceDir);

  // Hard deny known dangerous command aliases/patterns.
  if (policy.deny.includes(action) || deniedActionPatterns.some((p) => p.test(action))) {
    const denied = decision(
      "deny",
      `Action '${action}' is denied by policy.`,
      action,
      riskLevel,
    );
    if (policy.audit_all_agent_actions) {
      appendAuditEvent({
        action,
        status: "denied",
        reason: denied.reason,
        riskLevel,
        workspaceDir: context.workspaceDir,
        devicePort: context.devicePort,
        taskId: context.taskId,
      });
    }
    return denied;
  }

  if (
    policy.require_workspace_boundary &&
    hasProjectDir(args) &&
    isPathBoundaryUnsafe(String(args.projectDir))
  ) {
    const denied = decision(
      "deny",
      "Workspace boundary violation: root directory targets are not allowed.",
      action,
      riskLevel,
    );
    if (policy.audit_all_agent_actions) {
      appendAuditEvent({
        action,
        status: "denied",
        reason: denied.reason,
        riskLevel,
        workspaceDir: context.workspaceDir,
        devicePort: context.devicePort,
        taskId: context.taskId,
      });
    }
    return denied;
  }

  if (policy.require_device_lock_for_upload && (action === "upload_firmware" || action === "upload_filesystem")) {
    // Runtime lock manager still enforces this; policy check remains informative.
    if (!hasProjectDir(args)) {
      const denied = decision(
        "deny",
        "Upload actions require an explicit projectDir to enforce scoped device operations.",
        action,
        riskLevel,
      );
      if (policy.audit_all_agent_actions) {
        appendAuditEvent({
          action,
          status: "denied",
          reason: denied.reason,
          riskLevel,
          workspaceDir: context.workspaceDir,
          devicePort: context.devicePort,
          taskId: context.taskId,
        });
      }
      return denied;
    }
  }

  if (policy.approval_required.includes(action)) {
    const explicitApprovalId =
      typeof args.approvalId === "string" ? args.approvalId : undefined;
    const explicitApproved = args.approved === true || args.__approved === true;

    if (explicitApprovalId) {
      const request = getApproval(explicitApprovalId);
      if (request && request.status === "approved") {
        const allowed = decision(
          "allow",
          `Action '${action}' is allowed via approved request ${explicitApprovalId}.`,
          action,
          riskLevel,
          explicitApprovalId,
        );
        if (policy.audit_all_agent_actions) {
          appendAuditEvent({
            action,
            status: "approved",
            reason: allowed.reason,
            riskLevel,
            workspaceDir: context.workspaceDir,
            devicePort: context.devicePort,
            taskId: context.taskId,
            approvalId: explicitApprovalId,
          });
        }
        return allowed;
      }
    }

    if (explicitApproved) {
      const approved = createApprovalRequest({
        action,
        riskLevel,
        reason: `Action '${action}' explicitly approved by caller.`,
        requestedBy: context.actor ?? "user",
        metadata: { source: "inline-approved-flag" },
      });
      const allowed = decision(
        "allow",
        `Action '${action}' allowed by explicit caller approval.`,
        action,
        riskLevel,
        approved.id,
      );
      if (policy.audit_all_agent_actions) {
        appendAuditEvent({
          action,
          status: "approved",
          reason: allowed.reason,
          riskLevel,
          workspaceDir: context.workspaceDir,
          devicePort: context.devicePort,
          taskId: context.taskId,
          approvalId: approved.id,
        });
      }
      return allowed;
    }

    const approval = createApprovalRequest({
      action,
      riskLevel,
      reason: `Action '${action}' requires explicit approval by policy.`,
      requestedBy: context.actor ?? "agent",
      metadata: { args },
      expiresInMinutes: 30,
    });
    const needsApproval = decision(
      "requires_approval",
      `${action} requires explicit approval by policy.`,
      action,
      riskLevel,
      approval.id,
    );
    if (policy.audit_all_agent_actions) {
      appendAuditEvent({
        action,
        status: "requires_approval",
        reason: needsApproval.reason,
        riskLevel,
        workspaceDir: context.workspaceDir,
        devicePort: context.devicePort,
        taskId: context.taskId,
        approvalId: approval.id,
      });
    }
    return needsApproval;
  }

  const allowList = policy.allow.length > 0 ? policy.allow : defaultPolicy.allow;
  const isAllowed = allowList.includes(action) || !policy.deny.includes(action);
  const result = isAllowed
    ? decision(
        "allow",
        `Action '${action}' is allowed by policy.`,
        action,
        riskLevel,
      )
    : decision(
        "deny",
        `Action '${action}' is not permitted by policy.`,
        action,
        riskLevel,
      );

  if (policy.audit_all_agent_actions) {
    appendAuditEvent({
      action,
      status: result.status === "allow" ? "allowed" : "denied",
      reason: result.reason,
      riskLevel,
      workspaceDir: context.workspaceDir,
      devicePort: context.devicePort,
      taskId: context.taskId,
      approvalId: result.approvalId,
    });
  }

  return result;
}

