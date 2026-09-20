/**
 * Atomic, per-user physical-resource leases independent of project/cache/data directories.
 * Provides DeviceLeaseStore and stableDeviceLeaseRoot; adapters must resolve physical identity first.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PlatformIOError } from "../../utils/errors.js";
import {
  inspectProcessIdentity,
  compareProcessIdentity,
  type ProcessIdentity,
  type ProcessObservation,
} from "./process-identity.js";

/** A physical resource identity, not a raw session ID or an authorization grant. */
export interface DeviceResource {
  kind: "serial" | "probe";
  identity: string; // Stable, resolved physical identity shared by all aliases and adapters.
}
/** The returned object is a process-local release capability; copying its fields cannot release a lease. */
export interface DeviceLease {
  readonly resource: Readonly<DeviceResource>;
  readonly acquiredAt: string;
}
/** Advisory ownership snapshot; it never grants access or exposes the release/handoff nonce. */
export interface DeviceLeaseStatus {
  status: "unclaimed" | "owned" | "stale" | "unknown";
  resource: Readonly<DeviceResource>;
  ownerPid?: number;
  acquiredAt?: string;
}
/** Internal IPC handoff ticket. The target process must adopt it before opening hardware. */
export interface DeviceLeaseTransfer {
  readonly resource: Readonly<DeviceResource>;
  readonly nonce: string;
}
interface LeaseRecord {
  version: 1;
  resource: DeviceResource;
  owner: ProcessIdentity;
  nonce: string;
  acquiredAt: string;
}
/** Internal dependency injection for isolated tests, never populated from tool arguments. */
export interface DeviceLeaseStoreOptions {
  root?: string;
  inspect?: (pid: number) => ProcessObservation;
}

/** Use the account database home, not environment overrides, cache roots or project directories. */
export function stableDeviceLeaseRoot(): string {
  return path.join(
    os.userInfo().homedir,
    ".platformio-mcp",
    "device-leases-v1",
  );
}

/** Validate identity before hashing it into a filename. This does not discover device aliases. */
function resourceKey(resource: DeviceResource): string {
  if (
    !resource ||
    !["serial", "probe"].includes(resource.kind) ||
    typeof resource.identity !== "string" ||
    !resource.identity.trim() ||
    resource.identity.length > 1024 ||
    /[\x00-\x1f\x7f]/.test(resource.identity)
  )
    throw new PlatformIOError(
      "Invalid physical resource identity.",
      "DEVICE_IDENTITY_INVALID",
    );
  return createHash("sha256")
    .update(JSON.stringify([resource.kind, resource.identity]))
    .digest("hex");
}

/** Validate persisted and handoff metadata without trusting a PID-shaped value alone. */
function validProcessIdentity(value: ProcessIdentity): boolean {
  return (
    !!value &&
    Number.isSafeInteger(value.pid) &&
    value.pid >= 1 &&
    value.pid <= 2147483647 &&
    ["win32", "linux", "darwin"].includes(value.platform) &&
    typeof value.startToken === "string" &&
    value.startToken.length > 0 &&
    value.startToken.length <= 256
  );
}

function sameProcessIdentity(
  first: ProcessIdentity,
  second: ProcessIdentity,
): boolean {
  return (
    first.pid === second.pid &&
    first.platform === second.platform &&
    first.startToken === second.startToken
  );
}

/**
 * Short filesystem gates serialize acquisition/release/recovery; lease records persist between calls.
 * A gate left by a crashed writer fails closed and needs operator inspection. It is never stolen by age.
 * This coordinates cooperating same-user processes, not malicious same-user filesystem writers.
 */
export class DeviceLeaseStore {
  private readonly root: string;
  private readonly inspect: (pid: number) => ProcessObservation;
  private readonly held = new WeakMap<DeviceLease, LeaseRecord>();
  private owner?: ProcessIdentity;

  /** Construct a store; no file is created or device opened until acquisition. */
  constructor(options: DeviceLeaseStoreOptions = {}) {
    this.root = path.resolve(options.root ?? stableDeviceLeaseRoot());
    this.inspect = options.inspect ?? inspectProcessIdentity;
  }

  /** Inspect persisted ownership without releasing or recovering it; acquisition must still be atomic. */
  status(resource: DeviceResource): DeviceLeaseStatus {
    const key = resourceKey(resource);
    return this.withGate(key, () => {
      const record = this.readRecord(key);
      if (!record) return { status: "unclaimed", resource: { ...resource } };
      const identity = compareProcessIdentity(
        record.owner,
        this.inspect(record.owner.pid),
      );
      return {
        status: identity === "alive" ? "owned" : identity,
        resource: { ...record.resource },
        ownerPid: record.owner.pid,
        acquiredAt: record.acquiredAt,
      };
    });
  }

  /** Acquire exclusively, recovering a previous lease only after its owner is proven stale. */
  acquire(resource: DeviceResource): DeviceLease {
    const key = resourceKey(resource);
    const owner = this.currentOwner();
    return this.withGate(key, () => {
      const previous = this.readRecord(key);
      if (previous) {
        const status = compareProcessIdentity(
          previous.owner,
          this.inspect(previous.owner.pid),
        );
        if (status !== "stale")
          throw new PlatformIOError(
            status === "alive"
              ? "Physical resource is already owned."
              : "Physical resource ownership cannot be verified.",
            status === "alive" ? "DEVICE_BUSY" : "DEVICE_OWNER_UNKNOWN",
          );
      }
      const record: LeaseRecord = {
        version: 1,
        resource: { kind: resource.kind, identity: resource.identity },
        owner: { ...owner },
        nonce: randomUUID(),
        acquiredAt: new Date().toISOString(),
      };
      this.writeRecord(key, record);
      return this.createHandle(record);
    });
  }

  /**
   * Atomically transfer ownership to an already-started, verified child waiting behind an IPC barrier.
   * The caller must keep the child from opening hardware until adoption succeeds. No process is spawned here.
   * On success the old handle is invalid, even if delivery of the returned ticket subsequently fails.
   */
  transfer(lease: DeviceLease, target: ProcessIdentity): DeviceLeaseTransfer {
    const held = this.requireHandle(lease);
    const key = resourceKey(held.resource);
    if (
      !validProcessIdentity(target) ||
      target.platform !== held.owner.platform ||
      target.pid === held.owner.pid
    )
      throw new PlatformIOError(
        "Invalid lease transfer target.",
        "DEVICE_TRANSFER_INVALID",
      );
    return this.withGate(key, () => {
      const current = this.requirePersistedOwner(key, held);
      if (compareProcessIdentity(target, this.inspect(target.pid)) !== "alive")
        throw new PlatformIOError(
          "Lease transfer target is unavailable or its process identity changed.",
          "DEVICE_TRANSFER_INVALID",
        );
      const transferred: LeaseRecord = {
        ...current,
        owner: { ...target },
        nonce: randomUUID(),
      };
      this.writeRecord(key, transferred);
      this.held.delete(lease);
      return Object.freeze({
        resource: Object.freeze({ ...current.resource }),
        nonce: transferred.nonce,
      });
    });
  }

  /**
   * Consume an IPC ticket only in the target OS process, rotating its nonce to prevent ticket replay.
   * This grants lease custody, not tool authorization; public adapters must not accept transfer tickets.
   */
  adopt(ticket: DeviceLeaseTransfer): DeviceLease {
    const key = resourceKey(ticket?.resource);
    if (
      typeof ticket.nonce !== "string" ||
      !/^[a-f0-9-]{36}$/.test(ticket.nonce)
    )
      throw new PlatformIOError(
        "Invalid lease transfer ticket.",
        "DEVICE_TRANSFER_INVALID",
      );
    const owner = this.currentOwner();
    return this.withGate(key, () => {
      const current = this.readRecord(key);
      if (
        !current ||
        current.nonce !== ticket.nonce ||
        !sameProcessIdentity(current.owner, owner)
      )
        throw new PlatformIOError(
          "Lease transfer ticket is stale or belongs to another process.",
          "DEVICE_TRANSFER_INVALID",
        );
      const adopted = { ...current, nonce: randomUUID() };
      this.writeRecord(key, adopted);
      return this.createHandle(adopted);
    });
  }

  /** Release only a capability issued by this store whose persisted nonce and owner still match. */
  release(lease: DeviceLease): void {
    const held = this.requireHandle(lease);
    const key = resourceKey(held.resource);
    this.withGate(key, () => {
      this.requirePersistedOwner(key, held);
      fs.unlinkSync(path.join(this.root, `${key}.json`));
      this.held.delete(lease);
    });
  }

  private createHandle(record: LeaseRecord): DeviceLease {
    const lease: DeviceLease = Object.freeze({
      resource: Object.freeze({ ...record.resource }),
      acquiredAt: record.acquiredAt,
    });
    this.held.set(lease, record);
    return lease;
  }

  private requireHandle(lease: DeviceLease): LeaseRecord {
    const held = this.held.get(lease);
    if (!held)
      throw new PlatformIOError(
        "Unknown or already released device lease.",
        "DEVICE_LEASE_NOT_OWNED",
      );
    return held;
  }

  private requirePersistedOwner(key: string, held: LeaseRecord): LeaseRecord {
    const current = this.readRecord(key);
    if (
      !current ||
      current.nonce !== held.nonce ||
      !sameProcessIdentity(current.owner, held.owner)
    )
      throw new PlatformIOError(
        "Device lease ownership changed; refusing mutation.",
        "DEVICE_LEASE_NOT_OWNED",
      );
    return current;
  }

  private currentOwner(): ProcessIdentity {
    if (this.owner) return this.owner;
    const observation = this.inspect(process.pid);
    if (
      observation.status !== "running" ||
      observation.identity.pid !== process.pid ||
      !validProcessIdentity(observation.identity)
    )
      throw new PlatformIOError(
        "Cannot establish this process's start identity.",
        "DEVICE_OWNER_UNKNOWN",
      );
    this.owner = { ...observation.identity };
    return this.owner;
  }

  /** Refuse symlinked/non-directory components instead of silently splitting the global lock domain. */
  private ensureRoot(): void {
    const parsed = path.parse(this.root);
    let current = parsed.root;
    for (const part of this.root
      .slice(parsed.root.length)
      .split(path.sep)
      .filter(Boolean)) {
      current = path.join(current, part);
      try {
        fs.mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new PlatformIOError(
          "Device lease directory must not contain symlinks.",
          "DEVICE_LEASE_PATH_INVALID",
        );
    }
    const rootStat = fs.statSync(this.root);
    if (
      process.platform !== "win32" &&
      (rootStat.uid !== process.getuid?.() || (rootStat.mode & 0o022) !== 0)
    )
      throw new PlatformIOError(
        "Device lease directory must be owned by this user and not writable by others.",
        "DEVICE_LEASE_PATH_INVALID",
      );
  }

  private withGate<T>(key: string, action: () => T): T {
    this.ensureRoot();
    const gate = path.join(this.root, `${key}.gate`);
    try {
      fs.mkdirSync(gate, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new PlatformIOError(
          "Device lease update is busy or interrupted; retry, then inspect the gate if it persists.",
          "DEVICE_LEASE_GATE_BUSY",
        );
      throw error;
    }
    try {
      return action();
    } finally {
      fs.rmdirSync(gate);
    }
  }

  private readRecord(key: string): LeaseRecord | undefined {
    const file = path.join(this.root, `${key}.json`);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size > 8192
    )
      throw new PlatformIOError(
        "Invalid device lease record.",
        "DEVICE_LEASE_CORRUPT",
      );
    try {
      const record = JSON.parse(fs.readFileSync(file, "utf8")) as LeaseRecord;
      if (
        record.version !== 1 ||
        resourceKey(record.resource) !== key ||
        !validProcessIdentity(record.owner) ||
        typeof record.nonce !== "string" ||
        !/^[a-f0-9-]{36}$/.test(record.nonce) ||
        typeof record.acquiredAt !== "string" ||
        !Number.isFinite(Date.parse(record.acquiredAt))
      )
        throw new Error("Invalid lease schema");
      return record;
    } catch {
      throw new PlatformIOError(
        "Invalid device lease record; ownership is not assumed stale.",
        "DEVICE_LEASE_CORRUPT",
      );
    }
  }

  private writeRecord(key: string, record: LeaseRecord): void {
    const temporary = path.join(this.root, `${key}.${record.nonce}.tmp`);
    let fd: number | undefined;
    try {
      fd = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(fd, JSON.stringify(record), "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, path.join(this.root, `${key}.json`));
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try {
        fs.unlinkSync(temporary);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}
