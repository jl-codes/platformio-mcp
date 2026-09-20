/** Power bindings share serial exclusion identities and recheck them before startup. */
import { expect, it, vi } from "vitest";
import { bindPowerSerialDevice } from "../src/core/power/power-serial-discovery.js";
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
it("rejects endpoint-only or ambiguous USB identity", () => {
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
  expect(() =>
    bindPowerSerialDevice(
      "COM42",
      [record, { ...record, path: "COM43" }],
      async () => [],
      resolve,
    ),
  ).toThrow(expect.objectContaining({ code: "SERIAL_DEVICE_AMBIGUOUS" }));
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
