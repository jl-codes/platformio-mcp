/**
 * Trusted per-connection serial ownership and disconnect cleanup.
 * Provides SerialClientContext for MCP/API adapters; public arguments never select owners.
 */
import {
  PolicySerialSessionService,
  type SerialPolicyRequestContext,
} from "../core/serial/session-policy.js";
import type {
  SerialSessionInfo,
  SerialSessionOwner,
} from "../core/serial/session-manager.js";
import { PendingUploadStore } from "../core/analysis/pending-upload-store.js";
import type { executeRetainedEspUpload } from "../core/analysis/retained-upload-execution.js";
import { PlatformIOError } from "../utils/errors.js";

/** One instance belongs to one authenticated connection, never to a caller-supplied session ID. */
export class SerialClientContext {
  /** Host-only retained upload approvals and cleanup belong to this connection. */
  readonly pendingUploads = new PendingUploadStore<
    Awaited<ReturnType<typeof executeRetainedEspUpload>>
  >();
  private readonly owner: SerialSessionOwner;
  private closed = false;
  private closing?: Promise<SerialSessionInfo[]>;

  constructor(private readonly service = new PolicySerialSessionService()) {
    this.owner = service.sessions.createOwner();
  }

  /** Execute a trusted adapter under isolated request approvals and this connection's owner capability. */
  async run<T>(
    context: SerialPolicyRequestContext,
    execute: (
      service: PolicySerialSessionService,
      owner: SerialSessionOwner,
    ) => Promise<T>,
  ): Promise<T> {
    if (this.closed)
      throw new PlatformIOError("Serial client disconnected.", "SERIAL_CLOSED");
    const result = await this.service.run(context, () =>
      execute(this.service, this.owner),
    );
    if (this.closed)
      throw new PlatformIOError(
        "Serial client disconnected before result delivery.",
        "SERIAL_CLOSED",
      );
    return result;
  }

  /** Permanently reject new requests; coalesce cleanup while allowing a later retry of unconfirmed closure. */
  close(): Promise<SerialSessionInfo[]> {
    this.closed = true;
    if (!this.closing) {
      this.closing = Promise.all([
        this.pendingUploads.close(),
        this.service.sessions.disconnectOwner(this.owner),
      ])
        .then(([, sessions]) => sessions)
        .finally(() => {
          this.closing = undefined;
        });
    }
    return this.closing;
  }
}
