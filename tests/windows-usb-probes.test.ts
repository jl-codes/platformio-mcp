/** Windows PnP projection never promotes location-generated IDs to stable USB serial identities. */
import { expect, it } from "vitest";
import { parseWindowsUsbProbes } from "../src/core/devices/windows-usb-probes.js";
const record = {
  instanceId: "USB\\VID_1366&PID_0101\\ABC123",
  capabilities: 0xb4,
  location: "PCIROOT(0)#USBROOT(0)#USB(2)",
};
it("uses a device-provided serial and physical location", () => {
  expect(parseWindowsUsbProbes(JSON.stringify([record]))).toMatchObject({
    devices: [
      {
        vendorId: "1366",
        productId: "0101",
        serialNumber: "ABC123",
        location: record.location,
      },
    ],
    unidentified: 0,
  });
});
it("counts generated instance IDs and missing location data as unidentified", () => {
  expect(
    parseWindowsUsbProbes(
      JSON.stringify([
        { ...record, capabilities: 0xa4 },
        { ...record, location: null },
      ]),
    ),
  ).toMatchObject({ devices: [], unidentified: 2 });
});
it("ignores interface IDs and accepts an empty inventory", () => {
  expect(
    parseWindowsUsbProbes(
      JSON.stringify([
        { ...record, instanceId: "USB\\VID_1366&PID_0101&MI_00\\interface" },
      ]),
    ),
  ).toMatchObject({ devices: [] });
  expect(parseWindowsUsbProbes("[]")).toMatchObject({
    devices: [],
    unidentified: 0,
  });
});
it.each(["{}", "broken", JSON.stringify([{ instanceId: 42 }])])(
  "rejects malformed helper output",
  (value) => {
    expect(() => parseWindowsUsbProbes(value)).toThrowError(
      expect.objectContaining({ code: "DEBUG_PROBE_INVENTORY_INVALID" }),
    );
  },
);
