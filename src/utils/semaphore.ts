/**
 * Port Semaphore Manager
 * Coordinates physical UART ownership via the filesystem.
 *
 * Provides:
 * - SemaphoreManager: Singleton for hardware-level port locking.
 * - portSemaphoreManager: Default exported instance.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import {
  GLOBAL_LOCKS_DIR,
  canonicalPortName,
  ensureGlobalDirs,
  sanitizePortName,
} from "./paths.js";
import { PlatformIOError } from "./errors.js";

export type PortClaimType = "upload" | "monitor";

export interface PortClaim {
  type: PortClaimType;
  owner_workspace: string;
  owner_pid: number;
  /** Empty string for legacy claim files written before hostnames were recorded. */
  hostname: string;
  timestamp: number;
  operation_id?: string; // Distinguishes concurrent operations owned by the same process.
  startup_pending?: boolean; // Detached custody is uncertain until its child PID is published.
  /**
   * The real port path. Optional because claim filenames are sanitised and
   * lossy ("/dev/cu.x" becomes "dev_cu_x"), so legacy files cannot recover it.
   */
  port?: string;
  /**
   * For a monitor claim: the PID of the `pio device monitor` child that
   * actually holds the UART, which is NOT `owner_pid`.
   *
   * `owner_pid` is whoever called claimPort. Under MCP that was the long-lived
   * server, so probing it was a fair proxy for "is the monitor still running".
   * Under the CLI it is a one-shot process that exits immediately while the
   * detached monitor keeps the port — so the claim would read stale and the
   * next claimer would flash a port a live monitor still owns. Absent on
   * upload claims and on monitor claims written before this existed.
   */
  monitor_pid?: number;
}

/**
 * Base for every error `claimPort` can raise. Callers rethrow on this rather
 * than on PortBusyError alone, so a new claim error type cannot silently lose
 * its structured code the next time one is added.
 */
export class ClaimError extends PlatformIOError {
  constructor(
    message: string,
    code?: string,
    context?: Record<string, unknown>,
  ) {
    super(message, code, context);
    this.name = "ClaimError";
  }
}

/** Wraps filesystem failures so the CLI's structured error contract still applies. */
export class ClaimIoError extends ClaimError {
  constructor(
    operation: string,
    filePath: string,
    error: NodeJS.ErrnoException,
  ) {
    super(
      `Failed to ${operation} port claim file ${filePath}: ${error.code ?? error.message}`,
      "CLAIM_IO_ERROR",
      { operation, filePath, errno: error.code },
    );
    this.name = "ClaimIoError";
  }
}

/** Thrown when a port is held by a live claim owned by someone else, or by an
 * unidentified process during a reclaim race. */
export class PortBusyError extends ClaimError {
  constructor(port: string, claim: PortClaim | null, reason?: string) {
    super(
      claim
        ? `Port ${port} is already claimed by PID ${claim.owner_pid} ` +
            `(${claim.type}) in ${claim.owner_workspace}.`
        : (reason ??
            `Port ${port} was taken by another process while reclaiming a stale claim.`),
      "PORT_BUSY",
      { port, claim },
    );
    this.name = "PortBusyError";
  }
}

const DEFAULT_CLAIM_TTL_MS = 30 * 60 * 1000;

/**
 * Foreign-host monitors cannot be probed, so use a longer fallback TTL.
 * Local live monitors never expire; uncertain PID reuse needs explicit recovery.
 */
const DEFAULT_MONITOR_CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

function monitorClaimTtlMs(): number {
  const raw = process.env.PIO_MONITOR_CLAIM_TTL_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MONITOR_CLAIM_TTL_MS;
}

/** The TTL that applies to a claim: flash-sized for uploads, day-sized for monitors. */
function ttlForClaim(claim: PortClaim): number {
  return claim.type === "monitor" ? monitorClaimTtlMs() : claimTtlMs();
}

function claimTtlMs(): number {
  const raw = process.env.PIO_PORT_CLAIM_TTL_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CLAIM_TTL_MS;
}

/** A claim file being written is unreadable for a moment; do not destroy it. */
const UNREADABLE_GRACE_MS = 5_000;

/** proper-lockfile's minimum; a guard held longer than this belongs to a dead process. */
const GUARD_STALE_MS = 5000;
/** How long a caller waits on a contended guard before reporting the port busy. */
const GUARD_WAIT_MS = 2000;
const GUARD_POLL_MS = 10;

/** Blocking sleep for the synchronous claim API; the wait is bounded by GUARD_WAIT_MS. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

type ClaimFileState =
  | { kind: "absent" }
  | { kind: "ok"; claim: PortClaim; raw: string }
  | { kind: "unreadable"; ageMs: number; raw: string }
  | { kind: "denied"; errno: string };

/**
 * Port Semaphore Manager
 * Coordinates physical UART ownership via the filesystem.
 * Named .port.<sanitized_id>.lock to prevent collision and ensure server-wide consistency.
 */
export class SemaphoreManager {
  private static instance: SemaphoreManager;

  private constructor() {
    ensureGlobalDirs();
  }

  public static getInstance(): SemaphoreManager {
    if (!SemaphoreManager.instance) {
      SemaphoreManager.instance = new SemaphoreManager();
    }
    return SemaphoreManager.instance;
  }

  /**
   * Serialises every mutation of one port's claim file across processes.
   *
   * The claim file itself is published with link()/rename(), which are
   * atomic, but a classify-then-act pair (`releasePort`'s read and unlink,
   * `claimPort`'s stale check and republish) is two syscalls, and a
   * replacement claim published between them would be acted on under the
   * old claim's authority. The guard closes that window. It is a
   * proper-lockfile directory beside the claim file, chosen over the reclaim
   * breaker because it is crash-safe: a lock left by a dead process goes
   * stale after GUARD_STALE_MS and is taken over, so the highest-frequency
   * cleanup path in this file cannot wedge a port. Contention is brief (the
   * critical sections are a handful of syscalls), so callers spin for at most
   * GUARD_WAIT_MS before reporting the port busy.
   */
  private withPortGuard<T>(port: string, filePath: string, fn: () => T): T {
    const guard = `${filePath}.guard`;
    const deadline = Date.now() + GUARD_WAIT_MS;
    let release: () => void;
    for (;;) {
      try {
        release = lockfile.lockSync(guard, {
          realpath: false,
          stale: GUARD_STALE_MS,
          // The default handler throws from a timer if the guard's mtime
          // refresh fails -- say, a reset_server_state sweep removed the
          // directory while it was held -- which would crash the process
          // from an unrelated code path. The critical section is over in
          // milliseconds; a compromised guard is simply not ours to report.
          onCompromised: () => {},
        });
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ELOCKED") {
          throw new ClaimIoError("lock", guard, error as NodeJS.ErrnoException);
        }
        if (Date.now() >= deadline) {
          throw new PortBusyError(
            port,
            this.getClaim(port),
            `Port ${port}'s claim is being updated by another process right now.`,
          );
        }
        sleepSync(GUARD_POLL_MS);
      }
    }
    try {
      return fn();
    } finally {
      try {
        release();
      } catch {
        // A compromised or already-released guard is not the caller's failure.
      }
    }
  }

  private getLockFilePath(port: string): string {
    const id = sanitizePortName(canonicalPortName(port));
    return path.join(GLOBAL_LOCKS_DIR, `${id}.json`);
  }

  /**
   * Claims a physical port. Throws PortBusyError if the port is held by a live
   * distinct operation, including one in this process. An operation may refresh
   * its own same-type claim by supplying the returned operation_id.
   */
  public claimPort(
    port: string,
    reason: string = "Flash Operation",
    options: { operationId?: string } = {},
  ): PortClaim {
    ensureGlobalDirs();
    const filePath = this.getLockFilePath(port);
    const claim: PortClaim = {
      type: reason.toLowerCase().includes("monitor") ? "monitor" : "upload",
      owner_workspace: process.cwd(),
      owner_pid: process.pid,
      hostname: os.hostname(),
      timestamp: Date.now(),
      operation_id: options.operationId ?? randomUUID(),
      port,
    };
    if (claim.type === "monitor") claim.startup_pending = true;
    const content = JSON.stringify(
      { status: "busy", current_claim: claim },
      null,
      2,
    );

    return this.withPortGuard(port, filePath, () => {
      this.reconcileAliasClaims(port, filePath);
      if (this.tryCreateExclusive(filePath, content)) return claim;

      if (this.evaluateExisting(filePath, port, claim) === "reentrant") {
        this.replaceClaimAtomically(
          filePath,
          this.refreshedContent(port, claim),
        );
        return claim;
      }

      // Reclaimable. Serialise the unlink+create so two reclaimers cannot both win.
      return this.withReclaimBreaker(port, filePath, () => {
        const recheck = this.evaluateExisting(filePath, port, claim);
        if (recheck === "reentrant") {
          this.replaceClaimAtomically(
            filePath,
            this.refreshedContent(port, claim),
          );
          return claim;
        }
        if (recheck === "reclaim") fs.rmSync(filePath, { force: true });
        if (this.tryCreateExclusive(filePath, content)) return claim;
        throw new PortBusyError(port, this.getClaim(port));
      });
    });
  }

  /** Locate old claim filenames whose recorded port names the same canonical endpoint. */
  private getAliasClaims(
    port: string,
    filePath: string,
  ): Array<{ filePath: string; claim: PortClaim; raw: string }> {
    if (!fs.existsSync(GLOBAL_LOCKS_DIR)) return [];
    const canonicalPort = canonicalPortName(port);
    const matches: Array<{ filePath: string; claim: PortClaim; raw: string }> =
      [];
    for (const entry of fs.readdirSync(GLOBAL_LOCKS_DIR)) {
      if (!entry.endsWith(".json")) continue;
      const candidate = path.join(GLOBAL_LOCKS_DIR, entry);
      // Windows filename casing does not distinguish a legacy COM key from
      // its canonical name; never unlink the same file as an alias duplicate.
      if (
        candidate === filePath ||
        (process.platform === "win32" &&
          candidate.toLowerCase() === filePath.toLowerCase())
      )
        continue;
      try {
        const raw = fs.readFileSync(candidate, "utf8");
        const value = JSON.parse(raw);
        const recorded = value.current_claim ?? value;
        if (
          typeof recorded?.port !== "string" ||
          canonicalPortName(recorded.port) !== canonicalPort
        )
          continue;
        const claim = this.normaliseClaim(recorded, recorded.port);
        if (claim) matches.push({ filePath: candidate, claim, raw });
      } catch (error) {
        // Missing unrelated aliases cannot identify this endpoint. Requested
        // aliases are resolved separately and fail closed when unavailable.
        if (
          (error as NodeJS.ErrnoException).code === "ENOENT" ||
          error instanceof SyntaxError ||
          (error instanceof PlatformIOError &&
            error.code === "SERIAL_ENDPOINT_UNAVAILABLE")
        )
          continue;
        throw error;
      }
    }
    return matches;
  }

  /** Preserve pre-upgrade alias ownership before publishing or releasing the canonical key. */
  private reconcileAliasClaims(port: string, filePath: string): void {
    for (const alias of this.getAliasClaims(port, filePath)) {
      const current = this.classifyClaimFile(filePath, port);
      if (
        current.kind === "absent" &&
        this.tryCreateExclusive(filePath, alias.raw)
      ) {
        this.unlinkClaimIfUnchanged(alias.filePath, alias.raw);
      } else if (
        current.kind === "ok" &&
        this.matchesClaim(current.claim, alias.claim)
      ) {
        this.unlinkClaimIfUnchanged(alias.filePath, alias.raw);
      } else if (this.isClaimStale(alias.claim)) {
        this.unlinkClaimIfUnchanged(alias.filePath, alias.raw);
      } else {
        throw new PortBusyError(port, alias.claim);
      }
    }
  }

  /**
   * Publishes `content` at `filePath` atomically, or reports that it is taken.
   * Writes a temp file and links it into place: link() is atomic, fails EEXIST,
   * and never exposes a partially written file under the real name. It is also
   * the portable idiom over NFS, where O_EXCL is not reliably atomic.
   */
  private tryCreateExclusive(filePath: string, content: string): boolean {
    const tmp = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
    try {
      fs.writeFileSync(tmp, content);
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      throw new ClaimIoError("write", tmp, error as NodeJS.ErrnoException);
    }
    try {
      fs.linkSync(tmp, filePath);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return false;
      if (
        code === "EPERM" ||
        code === "ENOTSUP" ||
        code === "EOPNOTSUPP" ||
        code === "ENOSYS" || // Windows FAT32/exFAT surfaces here via libuv
        // Windows: CreateHardLinkW on FAT32/exFAT/SMB reports
        // ERROR_ACCESS_DENIED, which libuv maps to EACCES -- not EPERM. On
        // POSIX an EACCES from link(2) is a real permission problem and must
        // NOT silently degrade, so this is platform-gated.
        (code === "EACCES" && process.platform === "win32")
      ) {
        // FAT32/exFAT have no hard links. Degrade to the weaker O_EXCL create
        // rather than making every flash fail on such a volume: it is what the
        // tool did before link() was introduced, and still beats no exclusion.
        return this.createExclusiveWithoutLink(filePath, content);
      }
      throw new ClaimIoError("link", filePath, error as NodeJS.ErrnoException);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  private warnedNoHardLinks = false;

  /**
   * Fallback for filesystems without hard links. O_EXCL alone cannot prevent a
   * reader seeing a zero-length file mid-write, so the UNREADABLE_GRACE_MS rule
   * in evaluateExisting is what keeps this safe: a fresh unreadable file is
   * treated as held, never reclaimed.
   */
  private createExclusiveWithoutLink(
    filePath: string,
    content: string,
  ): boolean {
    if (!this.warnedNoHardLinks) {
      this.warnedNoHardLinks = true;
      console.error(
        `[pio-agent] ${path.dirname(filePath)} does not support hard links, so ` +
          `port claims use a weaker exclusion primitive there. Set ` +
          `PIO_MCP_DATA_DIR to a path on a modern filesystem for full protection.`,
      );
    }
    try {
      fs.writeFileSync(filePath, content, { flag: "wx" });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw new ClaimIoError(
        "create",
        filePath,
        error as NodeJS.ErrnoException,
      );
    }
  }

  /** Replaces our own claim without ever exposing a truncated file. */
  private replaceClaimAtomically(filePath: string, content: string): void {
    const tmp = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
    try {
      fs.writeFileSync(tmp, content);
      fs.renameSync(tmp, filePath);
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      throw new ClaimIoError(
        "replace",
        filePath,
        error as NodeJS.ErrnoException,
      );
    }
  }

  /**
   * Decides what to do about an existing claim file. Throws PortBusyError when
   * the port is genuinely held. Never returns "reclaim" for a file that might
   * belong to a live process.
   */
  private evaluateExisting(
    filePath: string,
    port: string,
    requested: PortClaim,
  ): "absent" | "reentrant" | "reclaim" {
    const state = this.classifyClaimFile(filePath, port);
    switch (state.kind) {
      case "absent":
        return "absent";
      case "denied":
        // An unreadable foreign claim on shared storage may well be live.
        throw new ClaimError(
          `Port claim file ${filePath} exists but cannot be read (${state.errno}). ` +
            `Refusing to reclaim a claim that may be live.`,
          "CLAIM_ACCESS_DENIED",
          { port, filePath, errno: state.errno },
        );
      case "unreadable":
        // A file mid-write is unreadable for milliseconds. Only an old
        // unreadable file is genuinely corrupt.
        if (state.ageMs < UNREADABLE_GRACE_MS) {
          throw new PortBusyError(
            port,
            null,
            `Port ${port} is being claimed by another process right now.`,
          );
        }
        return "reclaim";
      case "ok":
        if (
          this.isOwnedByThisProcess(state.claim) &&
          state.claim.type === requested.type &&
          state.claim.operation_id === requested.operation_id &&
          typeof state.claim.operation_id === "string"
        )
          return "reentrant";
        if (!this.isClaimStale(state.claim))
          throw new PortBusyError(port, state.claim);
        return "reclaim";
    }
  }

  /** Distinguishes absent, valid, unreadable and unauthorised claim files. */
  private classifyClaimFile(filePath: string, port: string): ClaimFileState {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf-8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { kind: "absent" };
      if (code === "EACCES" || code === "EPERM" || code === "EISDIR") {
        return { kind: "denied", errno: code };
      }
      throw new ClaimIoError("read", filePath, error as NodeJS.ErrnoException);
    }
    try {
      const parsed = JSON.parse(raw);
      const claim = this.normaliseClaim(parsed.current_claim ?? parsed, port);
      if (claim) return { kind: "ok", claim, raw };
    } catch {
      // Fall through: corrupt or mid-write.
    }
    let ageMs = Number.POSITIVE_INFINITY;
    try {
      ageMs = Date.now() - fs.statSync(filePath).mtimeMs;
    } catch {
      // Vanished underneath us; treat as old so it can be reclaimed.
    }
    return { kind: "unreadable", ageMs, raw };
  }

  private normaliseClaim(raw: any, port: string): PortClaim | null {
    if (!raw || typeof raw.owner_pid !== "number") return null;
    return {
      type: raw.type === "monitor" ? "monitor" : "upload",
      owner_workspace: String(raw.owner_workspace ?? "unknown"),
      owner_pid: raw.owner_pid,
      hostname: String(raw.hostname ?? ""),
      timestamp: Number(raw.timestamp ?? 0),
      ...(typeof raw.operation_id === "string"
        ? { operation_id: raw.operation_id }
        : {}),
      ...(typeof raw.startup_pending === "boolean"
        ? { startup_pending: raw.startup_pending }
        : {}),
      port: raw.port ? String(raw.port) : port,
      ...(typeof raw.monitor_pid === "number"
        ? { monitor_pid: raw.monitor_pid }
        : {}),
    };
  }

  /**
   * Serialises stale-claim reclamation so two reclaimers cannot both win.
   *
   * There is deliberately NO auto-recovery of an abandoned breaker. Removing a
   * breaker we do not own and then re-creating it is unlink-then-create, the
   * exact ABA this class exists to prevent, and guarding it with a read-back
   * only narrows the window rather than closing it: a stomp landing after the
   * read-back is invisible. An abandoned breaker therefore wedges one port
   * until `pio-agent port release --port <p>` clears it, which is the same
   * out-of-band recovery path a leaked claim already needs.
   */
  private withReclaimBreaker<T>(
    port: string,
    filePath: string,
    fn: () => T,
  ): T {
    const breaker = `${filePath}.reclaim`;
    const payload = JSON.stringify({
      pid: process.pid,
      hostname: os.hostname(),
      at: Date.now(),
    });

    if (!this.tryCreateExclusive(breaker, payload)) {
      throw new PortBusyError(
        port,
        null,
        `Port ${port} is being reclaimed by another process. If no such ` +
          `process exists, run: pio-agent port release --port ${port}`,
      );
    }

    try {
      return fn();
    } finally {
      fs.rmSync(breaker, { force: true });
    }
  }

  /** True when the PID is definitively gone. EPERM means alive under another user. */
  private isPidGone(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
  }

  /**
   * Records the monitor child's PID on an existing claim.
   *
   * Called after the child spawns, since its PID is not known at claim time.
   * Best-effort: a failure here degrades to the old launcher-PID behaviour
   * rather than breaking a working monitor.
   */
  public attachMonitorPid(
    port: string,
    monitorPid: number,
    operationId?: string,
  ): boolean {
    const filePath = this.getLockFilePath(port);
    const claim = this.getClaim(port);
    if (!claim || claim.type !== "monitor") return false;
    // Only ever amend OUR OWN claim. Between claimPort and the child spawning,
    // `pio` takes hundreds of milliseconds to start; if our claim were
    // reclaimed in that window, writing monitor_pid into the new owner's claim
    // would make THEIR port report liveness from OUR child, and their live
    // monitor's port would read stale the moment ours exits. Every other
    // mutation in this class is ownership- or breaker-guarded; so is this.
    if (!this.isOwnedByThisProcess(claim)) return false;
    try {
      return this.withPortGuard(port, filePath, () => {
        this.reconcileAliasClaims(port, filePath);
        // Re-read under the guard: the claim checked above may have been
        // released and republished by another process in the meantime.
        const current = this.getClaim(port);
        if (
          !current ||
          current.type !== "monitor" ||
          !this.isOwnedByThisProcess(current) ||
          (operationId !== undefined && current.operation_id !== operationId)
        )
          return false;
        const updated: PortClaim = {
          ...current,
          monitor_pid: monitorPid,
          startup_pending: false,
        };
        this.replaceClaimAtomically(
          filePath,
          JSON.stringify({ status: "busy", current_claim: updated }, null, 2),
        );
        return true;
      });
    } catch {
      return false;
    }
  }

  /**
   * Content for a re-entrant refresh of OUR OWN claim. The fresh claim never
   * carries monitor_pid (it is attached only after the child spawns), so
   * writing it verbatim silently downgraded a monitor claim to launcher-PID
   * staleness. Keep whatever monitor_pid is already on disk.
   */
  private refreshedContent(port: string, fresh: PortClaim): string {
    const existing = this.getClaim(port);
    if (existing && typeof existing.monitor_pid === "number") {
      fresh.monitor_pid = existing.monitor_pid;
      fresh.startup_pending = existing.startup_pending;
    }
    return JSON.stringify({ status: "busy", current_claim: fresh }, null, 2);
  }

  private isOwnedByThisProcess(claim: PortClaim): boolean {
    return claim.owner_pid === process.pid && claim.hostname === os.hostname();
  }

  /**
   * Clears an abandoned reclaim breaker. Abandoned breakers are never recovered
   * automatically, so this is the sanctioned out-of-band recovery, used by
   * `pio-agent port release`. Returns true if a breaker was removed.
   */
  public clearReclaimBreaker(port: string): boolean {
    const breaker = `${this.getLockFilePath(port)}.reclaim`;
    if (!fs.existsSync(breaker)) return false;
    fs.rmSync(breaker, { force: true });
    return true;
  }

  /**
   * Releases a claim. Only the owning process may release, unless the claim is
   * stale or `force` is passed. When `expectedType` is given, the type check
   * happens inside the same classify that authorises the unlink, so a claim
   * that changed between an earlier read and this call cannot be force-deleted
   * under the wrong type's authority (check-then-act). Returns true if a claim
   * was removed.
   *
   * Classify and unlink are two syscalls, so on their own a replacement claim
   * published between them (a reclaim that won, a fresh claim after another
   * releaser cleared the file) would be deleted under the OLD claim's
   * authority, freeing a port some process believes it holds. Two things
   * close that:
   *
   * - The whole method runs under the per-port guard, which every publish
   *   path also takes, so no cooperating process can replace the file while
   *   this one is between its read and its unlink.
   * - The unlink is conditional on the claim bytes being exactly what was
   *   classified. Anything else on disk -- a different claim, a file that
   *   vanished -- is left alone and reported as "not released". This also
   *   covers writers that bypass the guard (an admin reset, a legacy
   *   version of this tool sharing the directory).
   *
   * The guard is proper-lockfile rather than the reclaim breaker on purpose:
   * the breaker has no auto-recovery, and this method is the cleanup path of
   * every upload and every monitor stop, so a crash mid-release must not
   * wedge the port. The breaker still exists for the same reason it always
   * did -- to make an abandoned reclaim visible -- and `port release` still
   * clears it.
   */
  public releasePort(
    port: string,
    options: {
      force?: boolean;
      expectedType?: PortClaimType;
      expectedClaim?: PortClaim;
      requireStale?: boolean;
    } = {},
  ): boolean {
    const filePath = this.getLockFilePath(port);
    return this.withPortGuard(port, filePath, () => {
      this.reconcileAliasClaims(port, filePath);
      const state = this.classifyClaimFile(filePath, port);

      if (state.kind === "absent") return false;
      if (state.kind === "denied") return false;

      if (state.kind === "unreadable") {
        // A file mid-write is unreadable for milliseconds; only an old unreadable
        // file is genuinely abandoned. An expectedType cannot be confirmed on an
        // unreadable file, so refuse when one was required.
        if (options.expectedType || options.expectedClaim) return false;
        if (state.ageMs < UNREADABLE_GRACE_MS) return false;
        return this.unlinkClaimIfUnchanged(filePath, state.raw);
      }

      if (options.expectedType && state.claim.type !== options.expectedType) {
        return false;
      }

      // A confirmed stop authorizes this operation's claim, never a new monitor
      // that started while the asynchronous process termination was in flight.
      if (
        options.expectedClaim &&
        !this.matchesClaim(state.claim, options.expectedClaim)
      ) {
        return false;
      }
      if (options.requireStale && !this.isClaimStale(state.claim)) return false;

      if (options.force)
        return this.unlinkClaimIfUnchanged(filePath, state.raw);

      if (
        this.isOwnedByThisProcess(state.claim) ||
        this.isClaimStale(state.claim)
      ) {
        return this.unlinkClaimIfUnchanged(filePath, state.raw);
      }
      return false;
    });
  }

  /** Compare a stop's snapshot with the claim classified under the port guard. */
  private matchesClaim(current: PortClaim, expected: PortClaim): boolean {
    return (
      current.operation_id === expected.operation_id &&
      current.owner_pid === expected.owner_pid &&
      current.hostname === expected.hostname &&
      current.timestamp === expected.timestamp &&
      current.type === expected.type &&
      current.monitor_pid === expected.monitor_pid &&
      current.startup_pending === expected.startup_pending &&
      current.owner_workspace === expected.owner_workspace
    );
  }

  /**
   * Removes the claim file only if it still holds exactly the bytes that were
   * classified. A different claim, or none, means the decision above was
   * about a claim that no longer exists, and deleting what replaced it would
   * free a port another process holds. Reports honestly if it had vanished.
   */
  private unlinkClaimIfUnchanged(
    filePath: string,
    expectedRaw: string,
  ): boolean {
    let current: string;
    try {
      current = fs.readFileSync(filePath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new ClaimIoError("read", filePath, error as NodeJS.ErrnoException);
    }
    if (current !== expectedRaw) return false;
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new ClaimIoError(
        "unlink",
        filePath,
        error as NodeJS.ErrnoException,
      );
    }
  }

  /**
   * Checks if a port is physically claimed by a high-priority operation.
   *
   * Deliberately naive: existence only, ignoring staleness. It has no callers
   * left in this codebase — the one former caller (`startMonitor`'s pre-check)
   * was removed as a TOCTOU against `claimPort`. Callers almost certainly want
   * `getClaim`, which distinguishes stale/live/foreign and is race-safe when
   * paired with `claimPort`/`releasePort`'s own classify-then-act logic.
   */
  public isPortClaimed(port: string): boolean {
    const filePath = this.getLockFilePath(port);
    return fs.existsSync(filePath);
  }

  /** Retrieves the current claim for a port, normalised, or null. Never throws. */
  public getClaim(port: string): PortClaim | null {
    try {
      const filePath = this.getLockFilePath(port);
      const state = this.classifyClaimFile(filePath, port);
      if (state.kind === "ok") return state.claim;
      return state.kind === "absent"
        ? (this.getAliasClaims(port, filePath)[0]?.claim ?? null)
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Stale under exactly one of two tests, chosen by whether liveness is provable.
   *
   * Same host: `process.kill(owner_pid, 0)` is authoritative in BOTH directions —
   * a live PID is never stale however old the claim, and a dead one is always
   * stale. A serial monitor is routinely held for hours; reclaiming a
   * provably-live holder because a timer expired is never correct.
   *
   * Different host, or an empty hostname from a legacy claim file written before
   * hostnames were recorded: the PID cannot be probed, so the TTL is all there
   * is. This fails safe when PIO_MCP_DATA_DIR points at shared storage — probing
   * an ambiguous PID could incorrectly mark a live foreign claim as stale,
   * opening the double-flash bug this class exists to prevent.
   */
  public isClaimStale(claim: PortClaim): boolean {
    // Persist before spawn: failed attachment plus unconfirmed cleanup must
    // remain held even after the one-shot launcher has exited.
    if (claim.type === "monitor" && claim.startup_pending) return false;
    // A monitor claim is held by its detached child, not by whoever launched
    // it. That child is what owns the UART, so its liveness decides staleness
    // in both directions: a dead monitor frees the port even if the launcher
    // lives, and a live monitor holds it even though a one-shot CLI launcher
    // exited seconds after starting it.
    if (
      claim.type === "monitor" &&
      typeof claim.monitor_pid === "number" &&
      claim.hostname === os.hostname()
    ) {
      // A multi-day capture still owns its UART. PID reuse is uncertain and
      // requires explicit recovery rather than reclaiming a potentially live child.
      return this.isPidGone(claim.monitor_pid);
    }

    if (claim.hostname === os.hostname()) {
      // Background uploads and multi-day monitors can outlive fallback TTLs.
      // An alive or unprobeable PID remains held until explicit recovery.
      return this.isPidGone(claim.owner_pid);
    }
    return Date.now() - claim.timestamp > ttlForClaim(claim);
  }
}

export const portSemaphoreManager = SemaphoreManager.getInstance();
