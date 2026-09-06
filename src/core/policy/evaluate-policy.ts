import path from "node:path";
import {
  actionRiskLevels,
  defaultPolicy,
  deniedActionPatterns,
} from "./default-policy.js";
import {
  approveRequest,
  createApprovalRequest,
  getApproval,
} from "./approvals.js";
import { appendAuditEvent } from "./audit-log.js";
import {
  reserveAutomationWriteBudget,
  validateAutomationScope,
  type AutomationScopeInput,
} from "./automation-policy.js";
import { loadEffectivePolicyState } from "./load-policy.js";
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

function approvalMatchesScope(
  action: string,
  args: Record<string, unknown>,
  request: NonNullable<ReturnType<typeof getApproval>>,
): boolean {
  if (normalizeActionName(request.action) !== action) return false;
  const metadata = request.metadata ?? {};
  const approvedArgs =
    typeof metadata.args === "object" && metadata.args !== null
      ? (metadata.args as Record<string, unknown>)
      : {};

  for (const key of ["projectDir", "environment", "port"] as const) {
    const approved = approvedArgs[key];
    if (typeof approved !== "string") continue;
    const current = args[key];
    if (typeof current !== "string") return false;
    const matches =
      key === "projectDir"
        ? path.resolve(approved) === path.resolve(current)
        : approved === current;
    if (!matches) return false;
  }

  const approvedBinding = approvedArgs.targetBinding;
  if (typeof approvedBinding === "object" && approvedBinding !== null) {
    const currentBinding = args.targetBinding;
    if (
      typeof currentBinding !== "object" ||
      currentBinding === null ||
      (approvedBinding as Record<string, unknown>).digest !==
        (currentBinding as Record<string, unknown>).digest
    ) {
      return false;
    }
  }
  return true;
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
  const effectivePolicy = loadEffectivePolicyState(context.workspaceDir);
  const policy = effectivePolicy.policy;
  const auditContext = {
    workspaceDir: context.workspaceDir,
    devicePort: context.devicePort,
    taskId: context.taskId,
    automationKey: context.automationKey,
    targetBindingDigest: context.targetBindingDigest,
    policyProfile: effectivePolicy.profile,
    actorClass:
      context.actorClass ??
      (context.actor === "system" ? "system" : "interactive"),
  } as const;
  let scheduledScopeInput: AutomationScopeInput | undefined;
  let scheduledWriteOperation = false;

  if (context.actorClass === "scheduled" && context.automationKey) {
    try {
      scheduledScopeInput = {
        automationKey: context.automationKey,
        action,
        projectDir: String(args.projectDir ?? context.workspaceDir ?? ""),
        environment:
          typeof args.environment === "string"
            ? args.environment
            : typeof (args.targetBinding as Record<string, unknown> | undefined)
                  ?.environment === "string"
              ? String(
                  (args.targetBinding as Record<string, unknown>).environment,
                )
              : undefined,
        targetBinding:
          typeof args.targetBinding === "object" && args.targetBinding !== null
            ? (args.targetBinding as Parameters<
                typeof validateAutomationScope
              >[0]["targetBinding"])
            : undefined,
        maxRunDurationSeconds:
          typeof args.maxRunDurationSeconds === "number"
            ? args.maxRunDurationSeconds
            : typeof args.captureDurationSeconds === "number"
              ? args.captureDurationSeconds
              : typeof args.durationSeconds === "number"
                ? args.durationSeconds
                : typeof args.timeoutSeconds === "number"
                  ? args.timeoutSeconds
                  : 300,
      };
      scheduledWriteOperation =
        validateAutomationScope(scheduledScopeInput).writeOperation;
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "Unattended automation scope was denied.";
      const denied = decision("deny", reason, action, riskLevel);
      if (policy.audit_all_agent_actions) {
        appendAuditEvent({
          action,
          status: "denied",
          reason,
          riskLevel,
          ...auditContext,
        });
      }
      return denied;
    }
  }

  const reserveScheduledWrite = async (): Promise<
    PolicyDecision | undefined
  > => {
    if (!scheduledScopeInput || !scheduledWriteOperation) return undefined;
    try {
      await reserveAutomationWriteBudget(scheduledScopeInput);
      return undefined;
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "Unattended hardware-write budget was denied.";
      const denied = decision("deny", reason, action, riskLevel);
      if (policy.audit_all_agent_actions) {
        appendAuditEvent({
          action,
          status: "denied",
          reason,
          riskLevel,
          ...auditContext,
        });
      }
      return denied;
    }
  };

  // Hard deny known dangerous command aliases/patterns.
  if (
    policy.deny.includes(action) ||
    deniedActionPatterns.some((p) => p.test(action))
  ) {
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
        ...auditContext,
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
        ...auditContext,
      });
    }
    return denied;
  }

  if (
    policy.require_device_lock_for_upload &&
    (action === "upload_firmware" || action === "upload_filesystem")
  ) {
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
          ...auditContext,
        });
      }
      return denied;
    }
  }

  if (policy.approval_required.includes(action)) {
    const explicitApprovalId =
      typeof args.approvalId === "string" ? args.approvalId : undefined;
    const explicitApproved =
      context.actor === "user" &&
      (args.approved === true || args.__approved === true);

    if (explicitApprovalId) {
      const request = getApproval(explicitApprovalId);
      if (
        request &&
        request.status === "approved" &&
        approvalMatchesScope(action, args, request)
      ) {
        const reservationDenied = await reserveScheduledWrite();
        if (reservationDenied) return reservationDenied;
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
            ...auditContext,
            approvalId: explicitApprovalId,
          });
        }
        return allowed;
      }
    }

    if (explicitApproved) {
      const reservationDenied = await reserveScheduledWrite();
      if (reservationDenied) return reservationDenied;
      const approved = createApprovalRequest({
        action,
        riskLevel,
        reason: `Action '${action}' explicitly approved by caller.`,
        requestedBy: context.actor ?? "user",
        metadata: { source: "inline-approved-flag" },
      });
      approveRequest(approved.id);
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
          ...auditContext,
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
        ...auditContext,
        approvalId: approval.id,
      });
    }
    return needsApproval;
  }

  const allowList =
    policy.allow.length > 0 ? policy.allow : defaultPolicy.allow;
  const isAllowed = allowList.includes(action);
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

  if (result.status === "allow") {
    const reservationDenied = await reserveScheduledWrite();
    if (reservationDenied) return reservationDenied;
  }

  if (policy.audit_all_agent_actions) {
    appendAuditEvent({
      action,
      status: result.status === "allow" ? "allowed" : "denied",
      reason: result.reason,
      riskLevel,
      ...auditContext,
      approvalId: result.approvalId,
    });
  }

  return result;
}
