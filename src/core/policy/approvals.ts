/**
 * Persistent approval lifecycle and one-time consumption.
 * Provides request creation, terminal transitions, scope-bound consumption and safe summaries.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import lockfile from "proper-lockfile";
import { z } from "zod";
import type { ApprovalRequest, PolicyRiskLevel } from "./types.js";
import { resolvePolicyDirectory } from "./policy-sources.js";
import { PlatformIOError } from "../../utils/errors.js";

const ApprovalRecordSchema = z
  .object({
    id: z.string().regex(/^approval-[a-f0-9-]{36}$/),
    action: z.string(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    reason: z.string(),
    requestedBy: z.enum(["agent", "user", "system"]),
    status: z.enum(["pending", "approved", "denied", "expired", "consumed"]),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    scopeDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    consumedAt: z.string().datetime().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

/** Authority storage never follows writable-cache fallback discovery. */
function approvalsFile(): string {
  return path.join(resolvePolicyDirectory(), "approvals.json");
}

/** Reads a bounded validated store; corruption is never treated as an empty store. */
function readApprovals(file = approvalsFile()): ApprovalRequest[] {
  let text: string;
  try {
    if (fs.statSync(file).size > 8 * 1024 * 1024) throw new Error("size limit");
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new PlatformIOError(
      "Approval storage is unreadable or exceeds its size limit.",
      "APPROVAL_STORE_INVALID",
    );
  }
  try {
    return z.array(ApprovalRecordSchema).parse(JSON.parse(text));
  } catch {
    throw new PlatformIOError(
      "Approval storage is malformed; operator repair is required.",
      "APPROVAL_STORE_INVALID",
    );
  }
}

/** Replaces the complete store atomically inside its protected transaction. */
function writeApprovals(file: string, records: ApprovalRequest[]): void {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, JSON.stringify(records, null, 2), "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

/** Serializes mutations across processes; a busy store fails closed and may be retried. */
function mutate<T>(
  operation: (records: ApprovalRequest[], file: string) => T,
): T {
  const file = approvalsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let release: () => void;
  try {
    release = lockfile.lockSync(file, {
      realpath: false,
      stale: 120_000,
      retries: 0,
    });
  } catch {
    throw new PlatformIOError(
      "Approval storage is busy or unavailable; retry the operation.",
      "APPROVAL_STORE_BUSY",
    );
  }
  try {
    const records = readApprovals(file);
    const result = operation(records, file);
    writeApprovals(file, records);
    return result;
  } finally {
    release();
  }
}

/** A durable exclusive claim prevents replay even if a process crashes before saving status. */
function claimPath(file: string, id: string): string {
  return path.join(
    path.dirname(file),
    "approval-consumption",
    crypto.createHash("sha256").update(id).digest("hex"),
  );
}

/** Applies expiry to approved as well as pending records, and honors durable consumption. */
function currentState(record: ApprovalRequest, file: string): ApprovalRequest {
  if (fs.existsSync(claimPath(file, record.id)))
    return { ...record, status: "consumed" };
  if (
    (record.status === "pending" || record.status === "approved") &&
    record.expiresAt &&
    Date.parse(record.expiresAt) <= Date.now()
  )
    return { ...record, status: "expired" };
  return record;
}

/** Lists current approval state without mutating storage as a side effect of a read. */
export function listApprovalRequests(opts?: {
  status?: ApprovalRequest["status"];
  limit?: number;
}): ApprovalRequest[] {
  const file = approvalsFile();
  const records = readApprovals(file).map((record) =>
    currentState(record, file),
  );
  return records
    .filter((record) => !opts?.status || record.status === opts.status)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, Math.max(0, opts?.limit ?? records.length));
}

/** Creates a pending request with a bounded lifetime; it is not an execution grant. */
export function createApprovalRequest(input: {
  action: string;
  riskLevel: PolicyRiskLevel;
  reason: string;
  requestedBy: ApprovalRequest["requestedBy"];
  metadata?: Record<string, unknown>;
  expiresInMinutes?: number;
  scopeDigest?: string;
}): ApprovalRequest {
  const minutes = input.expiresInMinutes ?? 30;
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60)
    throw new PlatformIOError(
      "Approval lifetime must be between zero and 1440 minutes.",
      "APPROVAL_LIFETIME_INVALID",
    );
  const record: ApprovalRequest = ApprovalRecordSchema.parse({
    id: `approval-${crypto.randomUUID()}`,
    action: input.action,
    riskLevel: input.riskLevel,
    reason: input.reason,
    requestedBy: input.requestedBy,
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    scopeDigest: input.scopeDigest,
    metadata: input.metadata,
  });
  return mutate((records) => {
    records.push(record);
    return record;
  });
}

/** Transitions only pending requests; denied, expired and consumed grants cannot be resurrected. */
function transition(
  id: string,
  status: "approved" | "denied",
): ApprovalRequest | undefined {
  return mutate((records, file) => {
    const index = records.findIndex((record) => record.id === id);
    if (index < 0) return undefined;
    const record = currentState(records[index], file);
    if (
      record.status !== "pending" &&
      !(status === "denied" && record.status === "approved")
    ) {
      if (record.status === status) return record;
      throw new PlatformIOError(
        `Approval is ${record.status} and cannot become ${status}.`,
        "APPROVAL_TRANSITION_INVALID",
      );
    }
    records[index] = { ...record, status };
    return records[index];
  });
}

/** Grants a pending request through a trusted operator entrypoint. */
export function approveRequest(id: string): ApprovalRequest | undefined {
  return transition(id, "approved");
}
/** Denies a pending or approved request permanently. */
export function denyRequest(id: string): ApprovalRequest | undefined {
  return transition(id, "denied");
}
/** Reads one record with current expiry and consumption state. */
export function getApproval(id: string): ApprovalRequest | undefined {
  const file = approvalsFile();
  const record = readApprovals(file).find((item) => item.id === id);
  return record ? currentState(record, file) : undefined;
}

/**
 * Claims a matching, unexpired grant exactly once before execution.
 * Legacy grants without a scope digest or expiry cannot authorize operations.
 */
export function consumeApproval(
  id: string,
  scopeDigest: string,
): ApprovalRequest | undefined {
  return mutate((records, file) => {
    const index = records.findIndex((record) => record.id === id);
    if (index < 0) return undefined;
    const record = currentState(records[index], file);
    if (
      record.status !== "approved" ||
      !record.expiresAt ||
      record.scopeDigest !== scopeDigest
    )
      return undefined;
    const claim = claimPath(file, id);
    fs.mkdirSync(path.dirname(claim), { recursive: true, mode: 0o700 });
    const consumedAt = new Date().toISOString();
    try {
      const descriptor = fs.openSync(claim, "wx", 0o600);
      try {
        fs.writeFileSync(descriptor, consumedAt, "utf8");
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
      throw error;
    }
    records[index] = { ...record, status: "consumed", consumedAt };
    return records[index];
  });
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
    projectDir:
      typeof args.projectDir === "string" ? args.projectDir : undefined,
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
  return listApprovalRequests({
    status: "pending",
    limit: options?.limit ?? 50,
  })
    .map((request) => getApproval(request.id))
    .filter((request): request is ApprovalRequest => Boolean(request))
    .filter((request) => request.status === "pending")
    .map(summarizeApproval)
    .filter(
      (request) =>
        !options?.projectDir ||
        (Boolean(request.projectDir) &&
          path.resolve(request.projectDir!) ===
            path.resolve(options.projectDir)),
    )
    .slice(0, Math.min(100, Math.max(1, options?.limit ?? 20)));
}
