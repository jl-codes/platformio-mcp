/** Kernel-shaped filesystem fixtures exercise bounded USB discovery independently of attached hardware. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { enumerateLinuxUsbProbes } from "../src/core/devices/linux-usb-probes.js";
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pio-usb-sysfs-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
async function device(name: string, serial?: string) {
  const directory = path.join(root, name);
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, "idVendor"), "1366\n");
  await fs.writeFile(path.join(directory, "idProduct"), "0101\n");
  if (serial !== undefined)
    await fs.writeFile(path.join(directory, "serial"), serial + "\n");
}
it("enumerates physical devices while ignoring interface entries", async () => {
  await device("1-2", "probe");
  // Windows cannot create ':' fixture names; an unrelated directory is skipped on every host.
  await device("unrelated", "ignored");
  expect(await enumerateLinuxUsbProbes(root)).toEqual({
    devices: [
      {
        vendorId: "1366",
        productId: "0101",
        serialNumber: "probe",
        location: "1-2",
      },
    ],
    unidentified: 0,
    source: "linux_sysfs",
  });
});
it("reports serial-less devices without inventing physical identity", async () => {
  await device("1-3");
  expect(await enumerateLinuxUsbProbes(root)).toMatchObject({
    devices: [],
    unidentified: 1,
  });
});
it("bounds attribute reads and rejects malformed identities", async () => {
  await device("1-4", "x".repeat(300));
  await expect(enumerateLinuxUsbProbes(root)).rejects.toMatchObject({
    code: "DEBUG_PROBE_INVENTORY_INVALID",
  });
});
it("ignores a device removed before its identity can be read", async () => {
  await fs.mkdir(path.join(root, "1-5"));
  expect(await enumerateLinuxUsbProbes(root)).toMatchObject({
    devices: [],
    unidentified: 0,
  });
});
