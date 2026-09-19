import {
  GetApprovalRequestParamsSchema,
  GetPolicyStatusParamsSchema,
  ListPendingApprovalsParamsSchema,
} from "../../types.js";
import { getPolicyStatus } from "../../core/policy/status.js";
import {
  approveRequest,
  denyRequest,
  getApproval,
  getApprovalRequestSummary,
  listApprovalRequests,
  listPendingApprovalSummaries,
} from "../../core/policy/approvals.js";
import { asString, asNumber } from "../args.js";
import { PlatformIOError } from "../../utils/errors.js";
import type { CommandHandler } from "./types.js";

export const policyStatus: CommandHandler = async (ctx) => {
  const params = GetPolicyStatusParamsSchema.parse({
    projectDir: asString(ctx.options["project-dir"]),
  });
  return getPolicyStatus(params.projectDir);
};

export const approvals: CommandHandler = async (ctx) => {
  const status = asString(ctx.options.status) as
    | "pending"
    | "approved"
    | "denied"
    | "expired"
    | undefined;
  const limit = asNumber(ctx.options.limit);
  return listApprovalRequests({ status, limit });
};

export const approvalStatus: CommandHandler = async (ctx) => {
  const params = GetApprovalRequestParamsSchema.parse({
    approvalId: ctx.positionals[0],
    projectDir: asString(ctx.options["project-dir"]),
  });
  const result = getApprovalRequestSummary(
    params.approvalId,
    params.projectDir,
  );
  if (!result) {
    throw new PlatformIOError(
      `Approval request '${params.approvalId}' was not found in this scope.`,
      "APPROVAL_NOT_FOUND",
      { approvalId: params.approvalId, projectDir: params.projectDir },
    );
  }
  return result;
};

export const pendingApprovals: CommandHandler = async (ctx) => {
  const params = ListPendingApprovalsParamsSchema.parse({
    projectDir: asString(ctx.options["project-dir"]),
    limit: asNumber(ctx.options.limit),
  });
  const result = listPendingApprovalSummaries(params);
  return { approvals: result };
};

export const approve: CommandHandler = async (ctx) => {
  const approvalId = ctx.positionals[0];
  if (!approvalId) {
    throw new Error("Usage: approve <approval-id>");
  }
  const existing = getApproval(approvalId);
  if (!existing) {
    throw new Error(`Approval not found: ${approvalId}`);
  }
  const approval = approveRequest(approvalId);
  return { success: true, approval };
};

export const deny: CommandHandler = async (ctx) => {
  const approvalId = ctx.positionals[0];
  if (!approvalId) {
    throw new Error("Usage: deny <approval-id>");
  }
  const existing = getApproval(approvalId);
  if (!existing) {
    throw new Error(`Approval not found: ${approvalId}`);
  }
  const approval = denyRequest(approvalId);
  return { success: true, approval };
};
