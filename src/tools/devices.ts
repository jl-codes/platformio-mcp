/**
 * Device Discovery Tools
 * Device detection and listing tools.
 *
 * Provides:
 * - listDevices: Discovers connected serial adapters.
 * - findDeviceByPort: Resolves device by path.
 * - getFirstDevice: Resolves default device.
 * - hasConnectedDevices: Checks for existing endpoints.
 * - findDevicesByDescription: Queries devices by hardware description.
 * - findDevicesByHardwareId: Queries devices by internal identifier.
 * - findDeviceByHwid: Resolves a single device by exact hardware ID.
 */

import { platformioExecutor } from "../platformio.js";
import type { SerialDevice } from "../types.js";
import { DevicesArraySchema } from "../types.js";
import { PlatformIOError } from "../utils/errors.js";
import { mapVidPidToBoard } from "../utils/hardware-maps.js";

/**
 * Lists all connected serial devices.
 *
 * @returns Array object denoting active and accessible COM interfaces.
 */
export async function listDevices(): Promise<SerialDevice[]> {
  try {
    const result = (await platformioExecutor.executeWithJsonOutput(
      "device",
      ["list"],
      DevicesArraySchema,
      { timeout: 10000 },
    )) as SerialDevice[];

    // Enhance discovered devices with mapped board information
    return result.map((device) => {
      const detectedBoard = mapVidPidToBoard(device.hwid, device.description);
      if (detectedBoard) {
        return { ...device, detectedBoard };
      }
      return device;
    });
  } catch (error) {
    // If no devices are found, PlatformIO may return an error or empty array
    // Handle gracefully by returning empty array
    if (error instanceof PlatformIOError) {
      const errorMessage = error.message.toLowerCase();
      if (
        errorMessage.includes("no devices") ||
        errorMessage.includes("empty")
      ) {
        return [];
      }
    }

    throw new PlatformIOError(
      `Failed to list devices: ${error}`,
      "LIST_DEVICES_FAILED",
    );
  }
}

/**
 * Finds a device by port path.
 *
 * @param port - Path or designation of the serial port to find.
 * @returns Connected device descriptor or null if disconnected.
 */
export async function findDeviceByPort(
  port: string,
): Promise<SerialDevice | null> {
  const devices = await listDevices();
  return devices.find((device) => device.port === port) || null;
}

/**
 * Gets the first available valid serial device (useful for auto-detection).
 * Prioritizes actual physical USB modems over noisy Mac Bluetooth stacks.
 *
 * @returns Initially indexed verified device entry or null if none exist.
 */
export async function getFirstDevice(): Promise<SerialDevice | null> {
  const devices = await listDevices();
  if (devices.length === 0) return null;

  // Exclude native and secondary Bluetooth bridging drivers
  const validDevices = devices.filter((d) => {
    const p = d.port.toLowerCase();
    return (
      !p.includes("bluetooth") && !p.includes("blth") && !p.includes("bose")
    );
  });

  return validDevices.length > 0 ? validDevices[0] : devices[0];
}

/**
 * Checks if any devices are connected.
 *
 * @returns True if at least one serial device was discovered.
 */
export async function hasConnectedDevices(): Promise<boolean> {
  const devices = await listDevices();
  return devices.length > 0;
}

/**
 * Lists devices filtered by description (useful for finding specific board types).
 *
 * @param searchTerm - Keyword criteria to filter equipment details.
 * @returns Array collection of matched serial endpoints.
 */
export async function findDevicesByDescription(
  searchTerm: string,
): Promise<SerialDevice[]> {
  const devices = await listDevices();
  const searchLower = searchTerm.toLowerCase();

  return devices.filter((device) =>
    device.description.toLowerCase().includes(searchLower),
  );
}

/**
 * Lists devices filtered by hardware ID.
 *
 * @param searchTerm - Identifier or string footprint present in HWID.
 * @returns Filtered subsets of devices bound by hardware signatures.
 */
export async function findDevicesByHardwareId(
  searchTerm: string,
): Promise<SerialDevice[]> {
  const devices = await listDevices();
  const searchLower = searchTerm.toLowerCase();

  return devices.filter((device) =>
    device.hwid.toLowerCase().includes(searchLower),
  );
}

/**
 * Finds a specific device by its exact hardware ID.
 *
 * @param hwid - The hardware ID to match.
 * @returns The matched device or null.
 */
export async function findDeviceByHwid(
  hwid: string,
): Promise<SerialDevice | null> {
  const devices = await listDevices();
  return devices.find((device) => device.hwid === hwid) || null;
}

/**
 * Actively polls the system bus for a device matching a specific hardware ID to reappear.
 * Essential for macOS where ESP32-S3 boards physically drop off the bus and re-enumerate
 * with incremented port suffixes after a firmware flash.
 *
 * @param hwid - The exact hardware identifier (e.g., '303A:1001') to poll for.
 * @param timeoutMs - Maximum duration in milliseconds to wait before giving up.
 * @returns The newly assigned physical port path (e.g., '/dev/cu.usbmodem102') or null on timeout.
 */
export async function waitForDeviceByHwid(
  hwid: string,
  timeoutMs: number = 5000,
  logCallback?: (msg: string) => void,
): Promise<string | null> {
  if (!hwid) return null;

  const pollIntervalMs = 500;
  const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);

  // Extract rigid hardware attributes (VID:PID and Serial), ignoring transient macOS 'LOCATION=' strings
  const strictTokens = hwid
    .split(" ")
    .filter((t) => t.includes("VID:PID") || t.includes("SER"));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const devices = await listDevices();

    if (logCallback) {
      logCallback(
        `[Poll Attempt ${attempt}/${maxAttempts}] Discovered ${devices.length} system serial ports.\n`,
      );
      devices.forEach((d) =>
        logCallback(`  -> Discovered: ${d.port} (${d.hwid})\n`),
      );
    }

    const matchedDevice = devices.find((device) => {
      if (strictTokens.length > 0) {
        return strictTokens.every((token) => device.hwid.includes(token));
      }
      return device.hwid === hwid;
    });

    if (matchedDevice && matchedDevice.port) {
      if (attempt > 1 || logCallback) {
        const msg = `[Device Discovery] Device rigidly matched on port ${matchedDevice.port} (HWID: ${matchedDevice.hwid}) after ${attempt * pollIntervalMs}ms.`;
        console.error(msg);
        if (logCallback) logCallback(msg + "\n");
      }
      return matchedDevice.port;
    }

    // Non-blocking wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  const timeoutMsg = `[Device Discovery] Timeout (${timeoutMs}ms) waiting for stable signature: ${strictTokens.join(" ")}`;
  console.error(timeoutMsg);
  if (logCallback) logCallback(timeoutMsg + "\n");

  return null;
}
