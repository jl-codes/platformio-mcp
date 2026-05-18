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
