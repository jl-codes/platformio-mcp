/** Connection-local retained uploads bind resumed authorization to the exact previously captured firmware. */
import { randomUUID } from "node:crypto";
import { UploadCleanupFailure } from "./retained-upload-execution.js";
import { dispatchAuthorizedAction } from "../action-dispatcher.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import { PlatformIOError } from "../../utils/errors.js";
import type { retainUploadCapture } from "./upload-capture-record.js";

/** Host-resolved destination of a retained upload; public resume requests cannot replace this scope. */
export interface PendingUploadScope {
  projectDir: string;
  environment: string;
  uploadPort: string;
  deviceBinding?: string; // Host-discovered physical scope when available; never an authorization token.
}
interface PendingUpload<T, Context> {
  retained: Awaited<ReturnType<typeof retainUploadCapture>>;
  scope: PendingUploadScope;
  guard: () => void;
  execute: (signal: AbortSignal, context?: Context) => Promise<T>;
  abort: AbortController;
  expiresAt: number;
  state: "pending" | "authorizing" | "executing";
}

/**
 * Instantiate per connection, close on disconnect, and never share instances between callers.
 * Resumption does not rebuild: permission is bound to the retained manifest, destination and opaque
 * resume ID. Only the captured host callback may execute; a supplied ID is never an upload grant.
 */
export class PendingUploadStore<T, Context = void> {
  private readonly records = new Map<string, PendingUpload<T, Context>>();
  private closed = false;
  private readonly inFlight = new Set<Promise<T>>();
  private readonly cleanupOwners = new Set<UploadCleanupFailure>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Retain a bounded pending operation after capture; this does not acquire upload authorization. */
  stage(
    retained: Awaited<ReturnType<typeof retainUploadCapture>>,
    scope: PendingUploadScope,
    guard: () => void,
    execute: (signal: AbortSignal, context?: Context) => Promise<T>,
  ) {
    this.prune();
    const selected = { ...scope };
    const manifest = retained.manifest;
    if (this.closed || this.records.size + this.cleanupOwners.size >= 8)
      throw new PlatformIOError(
        "Pending upload capacity is unavailable.",
        "UPLOAD_RESUME_UNAVAILABLE",
      );
    if (
      manifest.projectDir !== selected.projectDir ||
      manifest.environment !== selected.environment ||
      !selected.uploadPort ||
      !/^[a-f0-9]{64}$/.test(retained.sha256)
    )
      throw new PlatformIOError(
        "Pending upload scope differs from captured firmware.",
        "UPLOAD_CAPTURE_CONTEXT_CHANGED",
      );
    guard();
    const resumeId = randomUUID();
    this.records.set(resumeId, {
      retained,
      scope: selected,
      guard,
      execute,
      abort: new AbortController(),
      expiresAt: this.now() + 15 * 60 * 1000,
      state: "pending",
    });
    return { resumeId, manifestSha256: retained.sha256 };
  }

  /** Authorize and consume the original captured upload exactly once; denied approvals remain resumable. */
  resume(
    resumeId: string,
    scope: PendingUploadScope,
    approvalId: string | undefined,
    caller: PolicyEvaluationContext,
    executionContext?: Context,
  ): Promise<T> {
    const attempt = this.resumePending(
      resumeId,
      scope,
      approvalId,
      caller,
      executionContext,
    );
    this.inFlight.add(attempt);
    void attempt.finally(() => this.inFlight.delete(attempt)).catch(() => {});
    return attempt;
  }

  private async resumePending(
    resumeId: string,
    scope: PendingUploadScope,
    approvalId: string | undefined,
    caller: PolicyEvaluationContext,
    executionContext?: Context,
  ): Promise<T> {
    this.prune();
    const record = this.records.get(resumeId);
    if (
      this.closed ||
      !record ||
      record.state !== "pending" ||
      record.scope.projectDir !== scope.projectDir ||
      record.scope.environment !== scope.environment ||
      record.scope.uploadPort !== scope.uploadPort ||
      record.scope.deviceBinding !== scope.deviceBinding
    )
      throw new PlatformIOError(
        "Pending upload is missing, busy or belongs to another destination.",
        "UPLOAD_RESUME_UNAVAILABLE",
      );
    record.guard();
    record.state = "authorizing";
    try {
      return await dispatchAuthorizedAction(
        "upload_firmware",
        {
          ...record.scope,
          purpose: "retained_upload",
          resumeId,
          manifestSha256: record.retained.sha256,
          approvalId,
        },
        { ...caller, workspaceDir: record.scope.projectDir },
        async () => {
          if (
            this.closed ||
            this.records.get(resumeId) !== record ||
            record.abort.signal.aborted ||
            this.now() >= record.expiresAt
          )
            throw new PlatformIOError(
              "Pending upload expired or disconnected before execution.",
              "UPLOAD_RESUME_UNAVAILABLE",
            );
          record.guard();
          record.state = "executing";
          await record.retained.verify();
          record.guard();
          if (record.abort.signal.aborted)
            throw new PlatformIOError(
              "Pending upload disconnected before execution.",
              "UPLOAD_RESUME_UNAVAILABLE",
            );
          return record.execute(record.abort.signal, executionContext);
        },
      );
    } catch (error) {
      if (error instanceof UploadCleanupFailure) this.cleanupOwners.add(error);
      throw error;
    } finally {
      const current = this.records.get(resumeId);
      if (current === record) {
        if (current.state === "executing") this.records.delete(resumeId);
        else current.state = "pending";
      }
    }
  }

  /** Keep an outer workflow's cleanup owner when final lease release needs a later retry. */
  retainCleanup(owner: UploadCleanupFailure): void {
    this.cleanupOwners.add(owner);
  }

  /** Disconnect invalidates pending IDs and cancels executing callbacks through their owned signal. */
  async close(): Promise<void> {
    this.closed = true;
    for (const record of this.records.values()) record.abort.abort();
    this.records.clear();
    await Promise.allSettled([...this.inFlight]);
    for (const owner of this.cleanupOwners) {
      await owner.cleanupProcess();
      this.cleanupOwners.delete(owner);
    }
  }

  private prune(): void {
    for (const [id, record] of this.records) {
      if (record.state !== "executing" && this.now() >= record.expiresAt) {
        record.abort.abort();
        this.records.delete(id);
      }
    }
  }
}
