/** Power bindings share serial exclusion identities and recheck them before startup. */
import { expect, it, vi } from "vitest";
import {
  bindPowerSerialDevice,
  selectPpk2Port,
} from "../src/core/power/power-serial-discovery.js";
import { resolveSerialEndpoint } from "../src/core/devices/serial-endpoint.js";
import { bindSerialDiscovery } from "../src/core/devices/serial-discovery-binding.js";
const resolve = (port: string) =>
  resolveSerialEndpoint(port, { platform: "win32" });
const record = {
  path: "COM42",
  vendorId: "1915",
  productId: "C00A",
  serialNumber: "fixture",
};
it("uses the exact endpoint and USB keys already used by serial sessions", async () => {
  const enumerate = vi.fn(async () => [record]);
  const selected = bindPowerSerialDevice("com42", [record], enumerate, resolve);
  const existing = bindSerialDiscovery(resolve("COM42"), [record], resolve);
  expect(selected.port).toBe("COM42");
  expect(selected.custody.resources).toEqual([
    resolve("COM42").resource,
    { kind: "serial", identity: existing.usbIdentity },
  ]);
  await selected.custody.revalidate();
  expect(enumerate).toHaveBeenCalledOnce();
});
it("rejects endpoint-only USB identity", () => {
  expect(() =>
    bindPowerSerialDevice(
      "COM42",
      [{ path: "COM42" }],
      async () => [],
      resolve,
    ),
  ).toThrow(
    expect.objectContaining({ code: "POWER_DEVICE_IDENTITY_REQUIRED" }),
  );
});
it("refuses device replacement or port drift at pre-spawn refresh", async () => {
  for (const changed of [
    { ...record, serialNumber: "replacement" },
    { ...record, path: "COM43" },
  ]) {
    const selected = bindPowerSerialDevice(
      "COM42",
      [record],
      async () => [changed],
      resolve,
    );
    await expect(selected.custody.revalidate()).rejects.toThrow();
  }
});

it("pins an explicitly selected interface while retaining the same whole-device key", async () => {
  const sibling = { ...record, path: "COM43" };
  let snapshot = [record, sibling];
  const selected = bindPowerSerialDevice(
    "COM42",
    snapshot,
    async () => snapshot,
    resolve,
  );
  const other = bindPowerSerialDevice(
    "COM43",
    snapshot,
    async () => snapshot,
    resolve,
  );
  expect(selected.custody.resources[1]).toEqual(other.custody.resources[1]);
  expect(selected.custody.resources[0]).not.toEqual(other.custody.resources[0]);
  snapshot = [sibling, record];
  await selected.custody.revalidate();
  for (const changed of [
    [record],
    [record, sibling, { ...record, path: "COM44" }],
    [record, { ...sibling, serialNumber: "replacement" }],
  ]) {
    snapshot = changed;
    await expect(selected.custody.revalidate()).rejects.toThrow(
      expect.objectContaining({ code: "SERIAL_DEVICE_CHANGED" }),
    );
  }
});

it("selects exactly one PPK2 among unrelated USB devices", () => {
  expect(
    selectPpk2Port(
      [record, { ...record, path: "COM9", productId: "0001" }],
      resolve,
    ),
  ).toBe("COM42");
  for (const records of [
    [],
    [{ ...record, productId: "0001" }],
    [record, { ...record, path: "COM43" }],
  ])
    expect(() => selectPpk2Port(records, resolve)).toThrow(
      expect.objectContaining({ code: "POWER_DEVICE_SELECTION_REQUIRED" }),
    );
});
