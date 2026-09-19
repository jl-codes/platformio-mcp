/** Trusted discovery identity binding tests; no enumeration or hardware access. */
import { describe, expect, it } from "vitest";
import { bindSerialDiscovery } from "../src/core/devices/serial-discovery-binding.js";
import { resolveSerialEndpoint } from "../src/core/devices/serial-endpoint.js";
const resolve = (port: string) =>
  resolveSerialEndpoint(port, { platform: "win32" });
const record = {
  path: "COM4",
  vendorId: "10C4",
  productId: "EA60",
  serialNumber: "board-1",
};
describe("serial discovery binding", () => {
  it("coalesces endpoint aliases and hexadecimal case while retaining serial-number case", () => {
    const binding = bindSerialDiscovery(
      resolve("com4"),
      [record, { ...record, path: "com4", vendorId: "10c4" }],
      resolve,
    );
    expect(binding.identityBasis).toBe("usb-descriptor");
    binding.revalidate([{ ...record, vendorId: "10c4", productId: "ea60" }]);
    expect(() =>
      binding.revalidate([{ ...record, serialNumber: "BOARD-1" }]),
    ).toThrow(expect.objectContaining({ code: "SERIAL_DEVICE_CHANGED" }));
  });
  it("rejects duplicate serial descriptors on different endpoints instead of guessing an interface", () => {
    expect(() =>
      bindSerialDiscovery(
        resolve("COM4"),
        [record, { ...record, path: "COM5" }],
        resolve,
      ),
    ).toThrow(expect.objectContaining({ code: "SERIAL_DEVICE_AMBIGUOUS" }));
  });
  it("rejects conflicting alias metadata", () => {
    expect(() =>
      bindSerialDiscovery(
        resolve("COM4"),
        [record, { ...record, path: "com4", serialNumber: "other" }],
        resolve,
      ),
    ).toThrow(expect.objectContaining({ code: "SERIAL_DEVICE_AMBIGUOUS" }));
  });
  it("does not automatically follow a matching USB descriptor to a new port", () => {
    const binding = bindSerialDiscovery(resolve("COM4"), [record], resolve);
    expect(() => binding.revalidate([{ ...record, path: "COM5" }])).toThrow(
      expect.objectContaining({ code: "SERIAL_DEVICE_UNAVAILABLE" }),
    );
  });
  it("labels missing USB identity and rejects later identity changes", () => {
    const binding = bindSerialDiscovery(
      resolve("COM4"),
      [{ path: "COM4" }],
      resolve,
    );
    expect(binding.identityBasis).toBe("endpoint-only");
    expect(binding.usbIdentity).toBeUndefined();
    expect(() => binding.revalidate([record])).toThrow(
      expect.objectContaining({ code: "SERIAL_DEVICE_CHANGED" }),
    );
  });
  it("rejects malformed and oversized discovery inputs", () => {
    for (const item of [
      { ...record, vendorId: "0x10c4" },
      { ...record, serialNumber: "x".repeat(513) },
    ])
      expect(() =>
        bindSerialDiscovery(resolve("COM4"), [item], resolve),
      ).toThrow();
    expect(() =>
      bindSerialDiscovery(resolve("COM4"), Array(1025).fill(record), resolve),
    ).toThrow();
  });
});
