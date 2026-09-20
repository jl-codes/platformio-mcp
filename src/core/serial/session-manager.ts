/**
 * Owned direct-serial sessions joining authorization, leases, bounded buffers and confirmed cleanup.
 * Provides SerialSessionManager. Public adapters must supply trusted client ownership and physical identity resolution.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  bindSerialDiscovery,
  type SerialDiscoveryRecord,
} from "../devices/serial-discovery-binding.js";
import { resolveSerialEndpoint } from "../devices/serial-endpoint.js";
import { PlatformIOError } from "../../utils/errors.js";
import {
  DeviceLeaseStore,
  type DeviceLease,
  type DeviceResource,
} from "../devices/device-lease.js";
import {
  SerialSessionBuffer,
  type SerialBufferLimits,
  type SerialReadOptions,
  type SerialBufferRead,
} from "./session-buffer.js";
import {
  createDirectSerialTransport,
  validateDirectSerialOptions,
  type DirectSerialOptions,
  type DirectSerialTransport,
  type SerialTransportState,
} from "./serial-transport.js";

/** Only the exact object issued by a manager identifies its trusted adapter/client principal. */
export interface SerialSessionOwner {
  readonly id: string;
}
/** Internal resolved request; resource identity must not be accepted unverified from tool arguments. */
export interface SerialSessionRequest extends DirectSerialOptions {
  projectDir: string;
  resource: DeviceResource;
  additionalResources?: readonly DeviceResource[]; // Trusted additional identity scopes, at most two.
  buffer?: SerialBufferLimits;
  /** Trusted adapter guard; never accepted from public JSON arguments. */
  revalidateEndpoint?: () => void | Promise<void>;
}
/** Authorization binds concrete session/request details without putting raw serial commands in metadata. */
export interface SerialSessionAuthorization {
  operation: "start" | "read" | "write";
  sessionId?: string;
  projectDir: string;
  resource: Readonly<DeviceResource>;
  additionalResources?: readonly Readonly<DeviceResource>[];
  path: string;
  baudRate: number;
  operationTimeoutMs: number;
  bufferLimits: Readonly<Required<SerialBufferLimits>>;
  bytesHash?: string;
  byteLength?: number;
}
/** Required hook returns a synchronous revision check to run immediately before effects/results. */
export type SerialSessionAuthorizer = (
  request: Readonly<SerialSessionAuthorization>,
) => Promise<() => void>;
/** Internal dependencies, never constructed from public request objects. */
export interface SerialSessionDependencies {
  authorize: SerialSessionAuthorizer;
  leases?: DeviceLeaseStore;
  transport?: typeof createDirectSerialTransport;
}
/** Bounded inspection state, available to its owner even when policy prevents new work. */
export interface SerialSessionInfo {
  linesBuffered: number;
  nextCursor: number;
  bytesReceived: number;
  sessionId: string;
  projectDir: string;
  path: string;
  baudRate: number;
  startedAt: string;
  state: SerialTransportState | "authorizing";
  cleanupPending: boolean;
  cleanupError?: string;
}
interface Session {
  id: string;
  owner: SerialSessionOwner;
  request: SerialSessionRequest;
  buffer: SerialSessionBuffer;
  startedAt: string;
  endedAt?: number;
  startPending: boolean;
  stopRequested: boolean;
  confirmedClosed: boolean;
  transport?: DirectSerialTransport;
  leases: DeviceLease[];
  cleanupError?: string;
}

/**
 * At most eight live/cleanup-pending sessions and sixteen completed buffers are retained.
 * Stopped buffers expire after ten minutes. Session IDs alone never establish ownership.
 */
export class SerialSessionManager {
  private readonly owners = new WeakSet<SerialSessionOwner>();
  private readonly disconnectedOwners = new WeakSet<SerialSessionOwner>();
  private readonly ownerStops = new WeakMap<SerialSessionOwner, number>();
  private pendingDiscovery = 0;
  private readonly sessions = new Map<string, Session>();
  private readonly leases: DeviceLeaseStore;
  private readonly makeTransport: typeof createDirectSerialTransport;

  /** Require authorization at construction; there is no permissive default hook. */
  constructor(private readonly dependencies: SerialSessionDependencies) {
    if (typeof dependencies.authorize !== "function")
      throw new PlatformIOError(
        "Serial session authorization is required.",
        "SERIAL_AUTHORIZATION_REQUIRED",
      );
    this.leases = dependencies.leases ?? new DeviceLeaseStore();
    this.makeTransport = dependencies.transport ?? createDirectSerialTransport;
  }

  /** Trusted adapters create one principal per authenticated client/session, never from caller-supplied IDs. */
  createOwner(): SerialSessionOwner {
    const owner = Object.freeze({ id: randomUUID() });
    this.owners.add(owner);
    return owner;
  }

  /** Capture owner cleanup before asynchronous adapter authorization starts. */
  createStartupGuard(owner: SerialSessionOwner): () => void {
    this.requireActiveOwner(owner);
    const generation = this.ownerStops.get(owner) ?? 0;
    return () => {
      this.requireActiveOwner(owner);
      if ((this.ownerStops.get(owner) ?? 0) !== generation)
        throw new PlatformIOError(
          "Serial startup was stopped.",
          "SERIAL_CLOSED",
        );
    };
  }

  /** Resolve OS endpoint aliases before authorization; this does not establish physical board identity. */
  async startEndpoint(
    owner: SerialSessionOwner,
    input: Omit<SerialSessionRequest, "resource" | "revalidateEndpoint">,
  ): Promise<SerialSessionInfo> {
    const endpoint = resolveSerialEndpoint(input.path);
    return this.start(owner, {
      ...input,
      path: endpoint.canonicalPort,
      resource: endpoint.resource,
      revalidateEndpoint: () => endpoint.revalidate(),
    });
  }

  /** Join trusted bounded discovery with endpoint and USB leases; adapters authorize enumeration separately. */
  async startDiscovered(
    owner: SerialSessionOwner,
    input: Omit<
      SerialSessionRequest,
      "resource" | "additionalResources" | "revalidateEndpoint"
    >,
    discovery: {
      list: () => Promise<readonly SerialDiscoveryRecord[]>;
      resolve?: typeof resolveSerialEndpoint;
      /** Trusted composite authorization hook; completes before lease acquisition or transport construction. */
      beforeStart?: (request: Readonly<SerialSessionRequest>) => Promise<void>;
    },
  ): Promise<SerialSessionInfo> {
    this.requireActiveOwner(owner);
    validateDirectSerialOptions(input);
    const request = {
      ...input,
      buffer: input.buffer ? { ...input.buffer } : undefined,
    };
    const list = discovery.list;
    const resolve = discovery.resolve ?? resolveSerialEndpoint;
    const stopGeneration = this.ownerStops.get(owner) ?? 0;
    this.requireCapacity();
    this.pendingDiscovery++;
    try {
      const endpoint = resolve(request.path);
      const binding = bindSerialDiscovery(
        endpoint,
        await this.withEndpointDeadline(
          list,
          request.operationTimeoutMs ?? 5000,
        ),
        resolve,
      );
      if ((this.ownerStops.get(owner) ?? 0) !== stopGeneration)
        throw new PlatformIOError(
          "Serial discovery was stopped.",
          "SERIAL_CLOSED",
        );
      const prepared: SerialSessionRequest = Object.freeze({
        ...request,
        buffer: request.buffer
          ? Object.freeze({ ...request.buffer })
          : undefined,
        path: endpoint.canonicalPort,
        resource: Object.freeze({ ...endpoint.resource }),
        additionalResources: Object.freeze(
          binding.usbIdentity
            ? [
                Object.freeze({
                  kind: "serial" as const,
                  identity: binding.usbIdentity,
                }),
              ]
            : [],
        ),
        revalidateEndpoint: async () => binding.revalidate(await list()),
      });
      if (discovery.beforeStart)
        await this.withEndpointDeadline(
          () => discovery.beforeStart!(prepared),
          request.operationTimeoutMs ?? 5000,
        );
      this.requireActiveOwner(owner);
      if ((this.ownerStops.get(owner) ?? 0) !== stopGeneration)
        throw new PlatformIOError(
          "Serial startup was stopped during preflight.",
          "SERIAL_CLOSED",
        );
      // Transfer the reservation synchronously to start before another request can interleave.
      this.pendingDiscovery--;
      try {
        return this.start(owner, prepared);
      } finally {
        this.pendingDiscovery++;
      }
    } finally {
      this.pendingDiscovery--;
    }
  }

  /** Authorize, acquire ownership, construct an unopened transport, revalidate, then open explicitly. */
  async start(
    owner: SerialSessionOwner,
    input: SerialSessionRequest,
  ): Promise<SerialSessionInfo> {
    this.requireActiveOwner(owner);
    validateDirectSerialOptions(input);
    if (!path.isAbsolute(input.projectDir))
      throw new PlatformIOError(
        "Serial project directory must be absolute.",
        "SERIAL_PROJECT_INVALID",
      );
    // Match authorization and listing, including native Windows path casing.
    const projectDir = fs.realpathSync.native(input.projectDir);
    if (!fs.statSync(projectDir).isDirectory())
      throw new PlatformIOError(
        "Serial project directory is not a directory.",
        "SERIAL_PROJECT_INVALID",
      );
    if (
      input.additionalResources !== undefined &&
      (!Array.isArray(input.additionalResources) ||
        input.additionalResources.length > 2)
    )
      throw new PlatformIOError(
        "Too many serial identity scopes.",
        "SERIAL_RESOURCE_INVALID",
      );
    const additionalResources = Object.freeze(
      (input.additionalResources ?? []).map((resource) =>
        Object.freeze({ kind: resource.kind, identity: resource.identity }),
      ),
    );
    const resources = [input.resource, ...additionalResources];
    if (
      resources.some((resource) => resource.kind !== "serial") ||
      new Set(resources.map((resource) => resource.identity)).size !==
        resources.length
    )
      throw new PlatformIOError(
        "Serial identity scopes must be distinct serial resources.",
        "SERIAL_RESOURCE_INVALID",
      );
    const buffer = new SerialSessionBuffer(input.buffer, true);
    this.prune();
    this.requireCapacity();
    const session: Session = {
      id: randomUUID(),
      owner,
      buffer,
      startedAt: new Date().toISOString(),
      startPending: true,
      stopRequested: false,
      confirmedClosed: false,
      leases: [],
      request: {
        path: input.path,
        revalidateEndpoint: input.revalidateEndpoint,
        baudRate: input.baudRate,
        operationTimeoutMs: input.operationTimeoutMs ?? 5000,
        buffer: Object.freeze({
          maxLines: input.buffer?.maxLines ?? 5000,
          maxBytes: input.buffer?.maxBytes ?? 1048576,
          maxLineBytes:
            input.buffer?.maxLineBytes ??
            Math.min(16384, input.buffer?.maxBytes ?? 1048576),
        }),
        projectDir,
        additionalResources,
        resource: Object.freeze({
          kind: input.resource.kind,
          identity: input.resource.identity,
        }),
      },
    };
    this.sessions.set(session.id, session);
    try {
      const guard = await this.authorize(session, "start");
      this.ensureNotStopped(session);
      guard();
      await this.checkEndpoint(session, guard);
      // Acquisition never waits: any contention rolls back the already-acquired scopes before opening.
      for (const resource of [
        session.request.resource,
        ...additionalResources,
      ].sort((a, b) => a.identity.localeCompare(b.identity)))
        session.leases.push(this.leases.acquire(resource));
      session.transport = await this.makeTransport(session.request, (bytes) =>
        session.buffer.append(bytes),
      );
      void session.transport.terminated.then((state) => {
        session.buffer.close(
          state,
          state === "error" ? "Serial transport failed." : undefined,
        );
      });
      void session.transport.confirmedClosed.then(() => {
        session.confirmedClosed = true;
        this.releaseLease(session);
      });
      this.ensureNotStopped(session);
      guard();
      await this.checkEndpoint(session, guard);
      await session.transport.open();
      this.ensureNotStopped(session);
      guard();
      await this.checkEndpoint(session, guard);
      session.startPending = false;
      this.markEnded(session);
      return this.info(session);
    } catch (error) {
      session.buffer.close(
        session.stopRequested ? "stopped" : "error",
        "Serial session did not start.",
      );
      if (session.transport) {
        try {
          await session.transport.close();
        } catch {
          session.cleanupError = "SERIAL_CLOSE_UNCONFIRMED";
        }
      } else {
        // Factory contract guarantees it never opens a port before returning its transport.
        session.confirmedClosed = true;
        this.releaseLease(session);
      }
      throw new PlatformIOError(
        error instanceof PlatformIOError
          ? error.message
          : "Serial session could not start.",
        error instanceof PlatformIOError ? error.code : "SERIAL_SESSION_FAILED",
        {
          ...(error instanceof PlatformIOError ? error.context : {}),
          sessionId: session.id,
          cleanupPending: session.leases.length > 0,
        },
      );
    } finally {
      session.startPending = false;
      this.markEnded(session);
    }
  }

  /** Read only owned data, checking authorization before waiting and again before returning it. */
  async read(
    owner: SerialSessionOwner,
    id: string,
    options: SerialReadOptions = {},
  ): Promise<SerialBufferRead> {
    const session = this.requireSession(owner, id);
    const guard = await this.authorize(session, "read");
    guard();
    const result = await session.buffer.read(options);
    guard();
    return result;
  }

  /** Bind approval to the copied payload digest, then revalidate immediately before the transport write. */
  async write(
    owner: SerialSessionOwner,
    id: string,
    bytes: Buffer,
  ): Promise<{ bytesWritten: number; drained: true }> {
    const session = this.requireSession(owner, id);
    if (!Buffer.isBuffer(bytes) || bytes.length > 65536)
      throw new PlatformIOError(
        "Serial writes are limited to 64 KiB.",
        "SERIAL_WRITE_LIMIT",
      );
    this.requireActiveOwner(owner);
    const copy = Buffer.from(bytes);
    const guard = await this.authorize(session, "write", copy);
    this.ensureNotStopped(session);
    this.requireActiveOwner(owner);
    guard();
    if (!session.transport)
      throw new PlatformIOError("Serial session is not open.", "SERIAL_CLOSED");
    return session.transport.write(copy);
  }

  /** Owned process-only cleanup remains available when policy is invalid or permission was revoked. */
  async stop(
    owner: SerialSessionOwner,
    id: string,
  ): Promise<SerialSessionInfo> {
    const session = this.requireSession(owner, id);
    session.stopRequested = true;
    session.buffer.close("stopped");
    if (session.transport) {
      try {
        await session.transport.close();
      } catch {
        session.cleanupError = "SERIAL_CLOSE_UNCONFIRMED";
      }
    }
    if (session.confirmedClosed) this.releaseLease(session);
    this.markEnded(session);
    return this.info(session);
  }

  /** Owner-scoped bounded status; no device is opened and no serial content is returned. */
  list(owner: SerialSessionOwner): SerialSessionInfo[] {
    this.requireOwner(owner);
    this.prune();
    return [...this.sessions.values()]
      .filter((session) => session.owner === owner)
      .map((session) => this.info(session));
  }

  /** Delete retained text only after physical closure and successful lease release. */
  forget(owner: SerialSessionOwner, id: string): void {
    const session = this.requireSession(owner, id);
    if (this.cleanupPending(session))
      throw new PlatformIOError(
        "Serial cleanup is still pending.",
        "SERIAL_CLEANUP_PENDING",
      );
    this.sessions.delete(id);
  }

  /** Capture once and always attempt owned cleanup, including cancelled/failed reads. */
  async capture(
    owner: SerialSessionOwner,
    request: SerialSessionRequest,
    options: SerialReadOptions = {},
  ): Promise<{
    read: SerialBufferRead;
    session: SerialSessionInfo;
    ok: boolean;
  }> {
    const started = await this.start(owner, request);
    let read: SerialBufferRead;
    try {
      read = await this.read(owner, started.sessionId, options);
    } catch (error) {
      const stopped = await this.stop(owner, started.sessionId);
      throw new PlatformIOError(
        error instanceof PlatformIOError
          ? error.message
          : "Serial capture failed.",
        error instanceof PlatformIOError ? error.code : "SERIAL_CAPTURE_FAILED",
        {
          ...(error instanceof PlatformIOError ? error.context : {}),
          sessionId: started.sessionId,
          cleanupPending: stopped.cleanupPending,
        },
      );
    }
    const session = await this.stop(owner, started.sessionId);
    return { read, session, ok: !session.cleanupPending };
  }

  /** Disconnect cleanup is scoped to one trusted client principal and never stops another owner's sessions. */
  async stopAll(owner: SerialSessionOwner): Promise<SerialSessionInfo[]> {
    this.requireOwner(owner);
    this.ownerStops.set(owner, (this.ownerStops.get(owner) ?? 0) + 1);
    return Promise.all(
      this.list(owner).map((session) => this.stop(owner, session.sessionId)),
    );
  }

  /** Permanently disable new device effects for a disconnected principal; owned cleanup remains retryable. */
  async disconnectOwner(
    owner: SerialSessionOwner,
  ): Promise<SerialSessionInfo[]> {
    this.requireOwner(owner);
    this.disconnectedOwners.add(owner);
    return this.stopAll(owner);
  }

  private async authorize(
    session: Session,
    operation: SerialSessionAuthorization["operation"],
    bytes?: Buffer,
  ): Promise<() => void> {
    const request = session.request;
    const guard = await this.dependencies.authorize(
      Object.freeze({
        operation,
        ...(operation === "start" ? {} : { sessionId: session.id }),
        operationTimeoutMs: request.operationTimeoutMs!,
        bufferLimits: request.buffer as Required<SerialBufferLimits>,
        projectDir: request.projectDir,
        resource: request.resource,
        ...(request.additionalResources?.length
          ? { additionalResources: request.additionalResources }
          : {}),
        path: request.path,
        baudRate: request.baudRate,
        ...(bytes
          ? {
              bytesHash: createHash("sha256").update(bytes).digest("hex"),
              byteLength: bytes.length,
            }
          : {}),
      }),
    );
    if (typeof guard !== "function")
      throw new PlatformIOError(
        "Serial authorization did not return a revision guard.",
        "SERIAL_AUTHORIZATION_REQUIRED",
      );
    return guard;
  }

  /** Bound trusted metadata waits without letting a late result resume a failed startup. */
  private async withEndpointDeadline<T>(
    run: () => T | Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(run),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new PlatformIOError(
                  "Serial endpoint verification timed out.",
                  "SERIAL_DISCOVERY_TIMEOUT",
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Recheck stop and policy after every asynchronous discovery boundary, before any device effect. */
  private async checkEndpoint(
    session: Session,
    guard: () => void,
  ): Promise<void> {
    if (session.request.revalidateEndpoint)
      await this.withEndpointDeadline(
        session.request.revalidateEndpoint,
        session.request.operationTimeoutMs!,
      );
    this.ensureNotStopped(session);
    guard();
  }

  /** Reserve capacity for discovery as well as already-created sessions. */
  private requireCapacity(): void {
    if (
      this.pendingDiscovery +
        [...this.sessions.values()].filter((session) =>
          this.cleanupPending(session),
        ).length >=
      8
    )
      throw new PlatformIOError(
        "Serial session capacity is full; close an owned session first.",
        "SERIAL_SESSION_LIMIT",
      );
  }

  private requireActiveOwner(owner: SerialSessionOwner): void {
    this.requireOwner(owner);
    if (this.disconnectedOwners.has(owner))
      throw new PlatformIOError(
        "Serial client disconnected.",
        "SERIAL_OWNER_DISCONNECTED",
      );
  }

  private requireOwner(owner: SerialSessionOwner): void {
    if (!this.owners.has(owner))
      throw new PlatformIOError(
        "Unknown serial session owner.",
        "SERIAL_SESSION_NOT_OWNED",
      );
  }

  private requireSession(owner: SerialSessionOwner, id: string): Session {
    this.requireOwner(owner);
    this.prune();
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner)
      throw new PlatformIOError(
        "Serial session is unavailable to this owner.",
        "SERIAL_SESSION_NOT_OWNED",
      );
    return session;
  }

  private ensureNotStopped(session: Session): void {
    if (session.stopRequested)
      throw new PlatformIOError("Serial session was stopped.", "SERIAL_CLOSED");
  }

  private releaseLease(session: Session): void {
    if (!session.confirmedClosed) return;
    const pending: DeviceLease[] = [];
    for (const lease of session.leases) {
      try {
        this.leases.release(lease);
      } catch {
        pending.push(lease);
      }
    }
    session.leases = pending;
    session.cleanupError = pending.length
      ? "SERIAL_LEASE_RELEASE_FAILED"
      : undefined;
    this.markEnded(session);
  }

  private cleanupPending(session: Session): boolean {
    return session.startPending || session.leases.length > 0;
  }
  private markEnded(session: Session): void {
    if (!this.cleanupPending(session)) {
      session.endedAt ??= performance.now();
      this.prune();
    }
  }
  private info(session: Session): SerialSessionInfo {
    const metadata = session.buffer.metadata();
    return {
      linesBuffered: metadata.linesBuffered,
      nextCursor: metadata.nextCursor,
      bytesReceived: metadata.bytesReceived,
      sessionId: session.id,
      projectDir: session.request.projectDir,
      path: session.request.path,
      baudRate: session.request.baudRate,
      startedAt: session.startedAt,
      state:
        session.transport?.state ??
        (session.startPending ? "authorizing" : metadata.state),
      cleanupPending: this.cleanupPending(session),
      cleanupError: session.cleanupError,
    };
  }
  private prune(): void {
    const completed = [...this.sessions.values()]
      .filter((session) => session.endedAt !== undefined)
      .sort((a, b) => a.endedAt! - b.endedAt!);
    for (let index = 0; index < completed.length; index++) {
      const session = completed[index];
      if (
        performance.now() - session.endedAt! > 600000 ||
        index < completed.length - 16
      )
        this.sessions.delete(session.id);
    }
  }
}
