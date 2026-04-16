/**
 * Hardware Lock Management
 * Singleton tracking global session leases for hardware operations.
 *
 * Provides:
 * - HardwareLockManager: Singleton class to lock/unlock execution flows.
 * - hardwareLockManager: Default exported instance.
 */

import { randomUUID } from "node:crypto";
import { PlatformIOError } from "./errors.js";
import { portalEvents } from "../api/events.js";

/**
 * Exception thrown when a process fails to acquire the global pipeline lock.
 */
export class QueueEnforcementError extends PlatformIOError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "QUEUE_ENFORCEMENT_FAILED", context);
    this.name = "QueueEnforcementError";
  }
}

/**
 * Internal representation of an actively held system hardware lock stream.
 */
export interface LockState {
  isLocked: boolean;
  sessionId?: string;
  reason?: string;
  lockedAt?: number;
}

export class HardwareLockManager {
  private static instance: HardwareLockManager;
  private state: LockState = { isLocked: false };

  private constructor() {}

  /**
   * Retrieves the global singleton instance
   */
  public static getInstance(): HardwareLockManager {
    if (!HardwareLockManager.instance) {
      HardwareLockManager.instance = new HardwareLockManager();
    }
    return HardwareLockManager.instance;
  }

  /**
   * Explicitly claim the internal lock for a session.
   * Throws if another session currently holds the lock.
   */
  public acquireLock(sessionId: string, reason?: string): void {
    if (this.state.isLocked && this.state.sessionId !== sessionId) {
      throw new QueueEnforcementError(
        `Hardware is currently tied up by ${this.state.sessionId || "another session"}. Please queue your task.`,
        {
          activeSession: this.state.sessionId,
          activeReason: this.state.reason,
        },
      );
    }

    this.state = {
      isLocked: true,
      sessionId,
      reason: reason || "Explicit Pipeline Lock",
      lockedAt: Date.now(),
    };
    try { portalEvents.emitLockState(this.state); } catch (e) {}
  }

  /**
   * Release the explicit lock, if it matches the current session ID.
   */
  public releaseLock(sessionId: string): void {
    if (this.state.isLocked && this.state.sessionId === sessionId) {
      this.state = { isLocked: false };
      try { portalEvents.emitLockState(this.state); } catch (e) {}
    }
  }

  /**
   * Get the current global lock state.
   */
  public getLockStatus(): LockState {
    return { ...this.state };
  }

  /**
   * Validate that an operation can proceed.
   * Operation can proceed if unlocked, or if the requester IS the locker.
   */
  public requireLock(sessionId?: string): void {
    if (this.state.isLocked && this.state.sessionId !== sessionId) {
      throw new QueueEnforcementError(
        `Hardware is currently tied up by session [${this.state.sessionId}]. Please queue your task.`,
        {
          activeSession: this.state.sessionId,
          activeReason: this.state.reason,
          action: "requireLock",
        },
      );
    }
  }

  /**
   * Implicit wrapping block for safe execution of a single task.
   * Grabs the lock implicitly, awaits the job, then releases it.
   */
  public async withImplicitLock<T>(action: () => Promise<T>): Promise<T> {
    // We use a reserved symbol for implicit locks so we don't accidentally unlock an explicit claim
    const implicitSessionId = `__IMPLICIT_${randomUUID()}__`;

    // Claiming atomically: acquireLock is synchronous and throws if already locked.
    // This removes the time-of-check to time-of-use (TOCTOU) race condition.
    this.acquireLock(implicitSessionId, "Implicit Tool Execution");
    try {
      const result = await action();
      return result;
    } finally {
      this.releaseLock(implicitSessionId);
    }
  }
}

export const hardwareLockManager = HardwareLockManager.getInstance();
