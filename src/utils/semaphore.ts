/**
 * Port Semaphore Manager
 * Coordinates physical UART ownership via the filesystem.
 *
 * Provides:
 * - SemaphoreManager: Singleton for hardware-level port locking.
 * - portSemaphoreManager: Default exported instance.
 */

import fs from "node:fs";
import path from "node:path";
import { LOCKS_DIR, ensureLocksDir, sanitizePortName } from "./paths.js";

/**
 * Port Semaphore Manager
 * Coordinates physical UART ownership via the filesystem.
 * Named .port.<sanitized_id>.lock to prevent collision and ensure server-wide consistency.
 */
export class SemaphoreManager {
  private static instance: SemaphoreManager;

  private constructor() {
    ensureLocksDir();
  }

  public static getInstance(): SemaphoreManager {
    if (!SemaphoreManager.instance) {
      SemaphoreManager.instance = new SemaphoreManager();
    }
    return SemaphoreManager.instance;
  }

  private getLockFilePath(port: string): string {
    const id = sanitizePortName(port);
    return path.join(LOCKS_DIR, `port_${id}.lock`);
  }

  /**
   * Claims a physical port by creating a lock file.
   * If the file already exists, it updates the timestamp.
   */
  public claimPort(port: string, reason: string = "Flash Operation"): void {
    const filePath = this.getLockFilePath(port);
    const content = JSON.stringify({
      port,
      reason,
      pid: process.pid,
      timestamp: Date.now(),
    }, null, 2);
    
    fs.writeFileSync(filePath, content);
  }

  /**
   * Releases a claim by removing the lock file.
   */
  public releasePort(port: string): void {
    const filePath = this.getLockFilePath(port);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /**
   * Checks if a port is physically claimed by a high-priority operation.
   */
  public isPortClaimed(port: string): boolean {
    const filePath = this.getLockFilePath(port);
    return fs.existsSync(filePath);
  }
}

export const portSemaphoreManager = SemaphoreManager.getInstance();
