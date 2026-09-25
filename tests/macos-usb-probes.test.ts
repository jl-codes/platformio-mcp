/** macOS USB JSON projection bounds traversal and retains only serial-backed identities. */
import { expect, it } from "vitest";
import { parseMacosUsbProbes } from "../src/core/devices/macos-usb-probes.js";
const probe = {
  vendor_id: "0x1366 (SEGGER)",
  product_id: "0x0101",
  serial_num: "ABC",
  location_id: "0x14100000 / 9",
};
it("finds devices beneath USB buses and nested hubs", () => {
  expect(
    parseMacosUsbProbes(
      JSON.stringify({ SPUSBDataType: [{ _name: "bus", _items: [probe] }] }),
    ),
  ).toMatchObject({
    devices: [
      {
        vendorId: "1366",
        productId: "0101",
        serialNumber: "ABC",
        location: "usb:14100000",
      },
    ],
    unidentified: 0,
  });
});
it("reports missing serials instead of deriving them from names", () => {
  expect(
    parseMacosUsbProbes(
      JSON.stringify({ SPUSBDataType: [{ ...probe, serial_num: undefined }] }),
    ),
  ).toMatchObject({ devices: [], unidentified: 1 });
});
it("bounds hostile nesting and rejects malformed device trees", () => {
  let node: unknown = probe;
  for (let index = 0; index < 34; index++) node = { _items: [node] };
  for (const value of [
    { SPUSBDataType: [node] },
    { SPUSBDataType: [{ _items: {} }] },
    { SPUSBDataType: [{ ...probe, vendor_id: "unknown" }] },
  ])
    expect(() => parseMacosUsbProbes(JSON.stringify(value))).toThrowError(
      expect.objectContaining({ code: "DEBUG_PROBE_INVENTORY_INVALID" }),
    );
});
