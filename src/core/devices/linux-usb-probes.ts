/** Bounded Linux USB identity discovery from kernel sysfs attributes without opening device handles. */
import fs from "node:fs/promises";
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";
import { selectDebugProbe, type UsbProbeRecord } from "./debug-probe.js";

/** Read one small sysfs attribute through a descriptor; never trust the reported pseudo-file length. */
async function attribute(file: string): Promise<string> {
  const handle = await fs.open(file, "r");
  try {
    const bytes = Buffer.alloc(258);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 257)
      throw new PlatformIOError(
        "USB identity attribute exceeds limits.",
        "DEBUG_PROBE_INVENTORY_INVALID",
      );
    return bytes
      .subarray(0, bytesRead)
      .toString("utf8")
      .replace(/\r?\n$/, "");
  } finally {
    await handle.close();
  }
}

/** Host-only root injection supports fixture validation; public requests must use the kernel root. */
export async function enumerateLinuxUsbProbes(root = "/sys/bus/usb/devices") {
  const entries = await fs.readdir(root);
  if (entries.length > 2048)
    throw new PlatformIOError(
      "USB inventory exceeds limits.",
      "DEBUG_PROBE_INVENTORY_INVALID",
    );
  const devices: UsbProbeRecord[] = [];
  let unidentified = 0;
  for (const name of entries.sort()) {
    if (!/^(?:usb[0-9]+|[0-9]+-[0-9]+(?:\.[0-9]+)*)$/.test(name)) continue;
    const directory = path.join(root, name);
    try {
      const [vendorId, productId] = await Promise.all([
        attribute(path.join(directory, "idVendor")),
        attribute(path.join(directory, "idProduct")),
      ]);
      let serialNumber: string;
      try {
        serialNumber = await attribute(path.join(directory, "serial"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        unidentified++;
        continue;
      }
      if (!serialNumber) {
        unidentified++;
        continue;
      }
      const probe = { vendorId, productId, serialNumber, location: name };
      // Shared validation and normalization makes every backend derive the same lease identity.
      devices.push(selectDebugProbe([probe]).probe);
    } catch (error) {
      // A device can disappear while enumerating; the pre-spawn inventory check will reject it.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
  return { devices, unidentified, source: "linux_sysfs" as const };
}
