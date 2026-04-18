/**
 * Project Path and Directory Management
 * Constants and helpers for managing the local server and project filesystem structure.
 *
 * Provides:
 * - PROJECT_ROOT: Resolution for the server install directory.
 * - LOCKS_DIR: Location for physical UART semaphore files.
 * - LOGS_DIR: Location for build and serial monitor trace files.
 * - ensureDir: Generic directory creation helper.
 * - ensureLocksDir: Specific helper for internal locks.
 * - sanitizePortName: Filename-safe transformation for serial paths.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root is two levels up from src/utils/
export const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
export const LOCKS_DIR = path.join(PROJECT_ROOT, ".locks");
export const LOGS_DIR = path.join(PROJECT_ROOT, "logs");

/**
 * Ensures a directory exists.
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Ensures the locks directory exists.
 */
export function ensureLocksDir(): void {
  ensureDir(LOCKS_DIR);
}

/**
 * Sanitizes a serial port path into a safe filename component.
 * e.g. /dev/cu.usbserial-110 -> dev_cu_usbserial-110
 *
 * @param port - The serial port path
 * @returns A safe string for use in filenames
 */
export function sanitizePortName(port: string): string {
  // Replace slashes, dots, and colons with underscores
  return port.replace(/[\/\.:]/g, "_").replace(/^_+|_+$/g, "");
}
