/** USB probe identity is physical and unique across duplicate interface enumeration. */
import { expect, it } from "vitest";
import { selectDebugProbe } from "../src/core/devices/debug-probe.js";
const probe = {
  vendorId: "0x1366",
  productId: "0101",
  serialNumber: "ABC123",
  location: "usb:1-2",
};
it("unifies interfaces while preserving serial identity", () => {
  const first = selectDebugProbe([probe, { ...probe, vendorId: "1366" }]);
  const moved = selectDebugProbe([{ ...probe, location: "usb:2-3" }]);
  expect(first.resource).toEqual(moved.resource);
  expect(first.resource.kind).toBe("probe");
});
it("requires an unambiguous selector", () => {
  const second = { ...probe, serialNumber: "other", location: "usb:1-3" };
  expect(() => selectDebugProbe([probe, second])).toThrowError(
    expect.objectContaining({ code: "DEBUG_PROBE_AMBIGUOUS" }),
  );
  expect(
    selectDebugProbe([probe, second], { serialNumber: "other" }).probe,
  ).toEqual({ ...second, vendorId: "1366" });
});
it("rejects cloned serials on different physical locations", () => {
  expect(() =>
    selectDebugProbe([probe, { ...probe, location: "usb:1-3" }]),
  ).toThrowError(expect.objectContaining({ code: "DEBUG_PROBE_AMBIGUOUS" }));
});
it("does not invent an identity for missing serial metadata or absent probes", () => {
  expect(() => selectDebugProbe([{ ...probe, serialNumber: "" }])).toThrowError(
    expect.objectContaining({ code: "DEBUG_PROBE_IDENTITY_INVALID" }),
  );
  expect(() => selectDebugProbe([])).toThrowError(
    expect.objectContaining({ code: "DEBUG_PROBE_NOT_FOUND" }),
  );
});
