import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ApprovalRequest, PolicyRiskLevel } from "./types.js";
import { SERVER_DATA_DIR } from "../../utils/paths.js";

const APPROVALS_FILE = path.join(
  SERVER_DATA_DIR,
  "approvals.json",
);

function ensureApprovalsFile() {
  const dir = path.dirname(APPROVALS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(APPROVALS_FILE)) fs.writeFileSync(APPROVALS_FILE, "[]", "utf8");
}

function readApprovals(): ApprovalRequest[] {
  ensureApprovalsFile();
  try {
    return JSON.parse(fs.readFileSync(APPROVALS_FILE, "utf8")) as ApprovalRequest[];
  } catch {
    return [];
  }
}

function writeApprovals(records: ApprovalRequest[]) {
  ensureApprovalsFile();
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify(records, null, 2), "utf8");
}

export function listApprovalRequests(
  opts?: { status?: ApprovalRequest["status"]; limit?: number },
): ApprovalRequest[] {
  const approvals = readApprovals();
  const filtered = opts?.status
    ? approvals.filter((item) => item.status === opts.status)
    : approvals;

  const sorted = filtered.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const limit = opts?.limit ?? sorted.length;
  return sorted.slice(0, Math.max(0, limit));
}

export function createApprovalRequest(input: {
  action: string;
  riskLevel: PolicyRiskLevel;
  reason: string;
  requestedBy: ApprovalRequest["requestedBy"];
  metadata?: Record<string, unknown>;
  expiresInMinutes?: number;
}): ApprovalRequest {
  const now = new Date();
  const expiresAt =
    input.expiresInMinutes && input.expiresInMinutes > 0
      ? new Date(now.getTime() + input.expiresInMinutes * 60_000).toISOString()
      : undefined;

  const record: ApprovalRequest = {
    id: `approval-${crypto.randomUUID()}`,
    action: input.action,
    riskLevel: input.riskLevel,
    reason: input.reason,
    requestedBy: input.requestedBy,
    status: "pending",
    createdAt: now.toISOString(),
    expiresAt,
    metadata: input.metadata,
  };

  const approvals = readApprovals();
  approvals.push(record);
  writeApprovals(approvals);
  return record;
}

export function approveRequest(id: string): ApprovalRequest | undefined {
  const approvals = readApprovals();
  const idx = approvals.findIndex((x) => x.id === id);
  if (idx === -1) return undefined;
  approvals[idx].status = "approved";
  writeApprovals(approvals);
  return approvals[idx];
}

export function denyRequest(id: string): ApprovalRequest | undefined {
  const approvals = readApprovals();
  const idx = approvals.findIndex((x) => x.id === id);
  if (idx === -1) return undefined;
  approvals[idx].status = "denied";
  writeApprovals(approvals);
  return approvals[idx];
}

export function getApproval(id: string): ApprovalRequest | undefined {
  const approvals = readApprovals();
  const approval = approvals.find((x) => x.id === id);
  if (!approval) return undefined;
  if (
    approval.status === "pending" &&
    approval.expiresAt &&
    new Date(approval.expiresAt).getTime() < Date.now()
  ) {
    approval.status = "expired";
    writeApprovals(approvals);
  }
  return approval;
}

/** Agent-readable approval summary that excludes raw tool arguments. */
export interface ApprovalRequestSummary {
  id: string;
  action: string;
  riskLevel: PolicyRiskLevel;
  reason: string;
  requestedBy: ApprovalRequest["requestedBy"];
  status: ApprovalRequest["status"];
  createdAt: string;
  expiresAt?: string;
  projectDir?: string;
  environment?: string;
  port?: string;
}

/**
 * Extracts only allowlisted, non-secret scope fields from approval metadata.
 *
 * @param request - Stored approval request.
 * @returns Safe agent-readable approval summary.
 */
function summarizeApproval(request: ApprovalRequest): ApprovalRequestSummary {
  const metadata = request.metadata ?? {};
  const args =
    typeof metadata.args === "object" && metadata.args !== null
      ? (metadata.args as Record<string, unknown>)
      : metadata;
  return {
    id: request.id,
    action: request.action,
    riskLevel: request.riskLevel,
    reason: request.reason,
    requestedBy: request.requestedBy,
    status: request.status,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    projectDir: typeof args.projectDir === "string" ? args.projectDir : undefined,
    environment:
      typeof args.environment === "string" ? args.environment : undefined,
    port: typeof args.port === "string" ? args.port : undefined,
  };
}

/**
 * Reads one approval without exposing an approval mutation.
 *
 * @param id - Approval request identifier.
 * @param projectDir - Optional project boundary assertion.
 * @returns Safe summary or undefined when missing/out of scope.
 */
export function getApprovalRequestSummary(
  id: string,
  projectDir?: string,
): ApprovalRequestSummary | undefined {
  const request = getApproval(id);
  if (!request) return undefined;
  const summary = summarizeApproval(request);
  if (
    projectDir &&
    (!summary.projectDir ||
      path.resolve(summary.projectDir) !== path.resolve(projectDir))
  ) {
    return undefined;
  }
  return summary;
}

/**
 * Lists pending approvals, optionally constrained to one project.
 *
 * @param options - Project scope and result limit.
 * @returns Newest-first safe approval summaries.
 */
export function listPendingApprovalSummaries(options?: {
  projectDir?: string;
  limit?: number;
}): ApprovalRequestSummary[] {
  return listApprovalRequests({ status: "pending", limit: options?.limit ?? 50 })
    .map((request) => getApproval(request.id))
    .filter((request): request is ApprovalRequest => Boolean(request))
    .filter((request) => request.status === "pending")
    .map(summarizeApproval)
    .filter(
      (request) =>
        !options?.projectDir ||
        (Boolean(request.projectDir) &&
          path.resolve(request.projectDir!) === path.resolve(options.projectDir)),
    )
    .slice(0, Math.min(100, Math.max(1, options?.limit ?? 20)));
}
