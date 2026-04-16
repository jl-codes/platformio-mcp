import { describe, it, expect, beforeEach } from "vitest";
import { HardwareLockManager, QueueEnforcementError } from "../src/utils/lock-manager.js";

describe("HardwareLockManager", () => {
  let lockManager: any;

  beforeEach(() => {
    // We create a fresh instance for testing
    // HardwareLockManager has a private constructor and a getInstance, but we can access it or reset state if needed
    // Actually, HardwareLockManager is a singleton, so we can just use the exported one, but we might want to release its lock.
    lockManager = HardwareLockManager.getInstance();
    lockManager.state = { isLocked: false }; // Private field, but good enough for TS? No, let's use public API
  });

  it("should acquire and release an explicit lock", () => {
    lockManager.acquireLock("test-session", "Test reason");
    expect(lockManager.getLockStatus().isLocked).toBe(true);
    expect(lockManager.getLockStatus().sessionId).toBe("test-session");

    lockManager.releaseLock("test-session");
    expect(lockManager.getLockStatus().isLocked).toBe(false);
  });

  it("should throw when acquiring a lock that is already held by another session", () => {
    lockManager.acquireLock("owner-session", "Test");
    
    expect(() => {
      lockManager.acquireLock("other-session", "Another test");
    }).toThrow(QueueEnforcementError);

    lockManager.releaseLock("owner-session");
  });

  it("should execute task and manage implicit lock", async () => {
    let executed = false;
    await lockManager.withImplicitLock(async () => {
      executed = true;
      expect(lockManager.getLockStatus().isLocked).toBe(true);
    });

    expect(executed).toBe(true);
    expect(lockManager.getLockStatus().isLocked).toBe(false);
  });

  it("should reject concurrent implicit locks atomically", async () => {
    // We will start one explicit/implicit lock and try another
    lockManager.acquireLock("concurrent-test", "Locking the queue");
    
    await expect(lockManager.withImplicitLock(async () => {
      return "Should not execute";
    })).rejects.toThrow(QueueEnforcementError);

    lockManager.releaseLock("concurrent-test");
  });

  it("should allow re-entrant requireLock for the same session", () => {
    lockManager.acquireLock("re-entrant-session");
    
    expect(() => {
      lockManager.requireLock("re-entrant-session");
    }).not.toThrow();
    
    lockManager.releaseLock("re-entrant-session");
  });
});
