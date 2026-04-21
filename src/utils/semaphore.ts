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
import { GLOBAL_LOCKS_DIR, ensureGlobalDirs, sanitizePortName } from "./paths.js";

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

  private getLockFilePath(port: string): string {
    const id = sanitizePortName(port);
    return path.join(GLOBAL_LOCKS_DIR, `${id}.json`);
  }

  /**
   * Claims a physical port by creating a lock file.
   * If the file already exists, it updates the timestamp.
   */
  public claimPort(port: string, reason: string = "Flash Operation"): void {
    const filePath = this.getLockFilePath(port);
    const content = JSON.stringify({
      status: "busy",
      current_claim: {
        type: reason.toLowerCase().includes("monitor") ? "monitor" : "upload",
        owner_workspace: process.cwd(),
        owner_pid: process.pid,
        timestamp: Date.now()
      }
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

  /**
   * Retrieves the current claim payload for a port, if it exists.
   */
  public getClaim(port: string): any | null {
    const filePath = this.getLockFilePath(port);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(content);
        return parsed.current_claim || parsed;
      } catch (e) {
        return null;
      }
    }
    return null;
  }
}


export const portSemaphoreManager = SemaphoreManager.getInstance();
