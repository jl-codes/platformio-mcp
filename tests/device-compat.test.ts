/** Device hints are presentation only and must not leak internal claim metadata. */
import { expect, it } from "vitest";
import { projectCompatibilityDevices } from "../src/adapters/device-compat.js";
it("sorts likely ports stably, suppresses noise and excludes internal identities", () => {
  const source = [
    { port: "COM1", description: "Bluetooth USB", hwid: "noise" },
    {
      port: "COM2",
      description: "CP2102",
      hwid: "USB",
      claim: { nonce: "private" },
      detectedBoard: "inferred",
    },
    { port: "COM3", description: "CMSIS-DAP", hwid: "" },
  ];
  const result = projectCompatibilityDevices(source);
  expect(result.likely_ports).toEqual(["COM2", "COM3"]);
  expect(result.devices.map((row) => row.port)).toEqual([
    "COM2",
    "COM3",
    "COM1",
  ]);
  expect(result.devices[0]).toEqual({
    port: "COM2",
    description: "CP2102",
    hwid: "USB",
    likely_dev_board: true,
  });
  expect(source[0].port).toBe("COM1");
  expect(result).not.toHaveProperty("open_monitor_sessions");
});
it("reports no-device evidence without inventing a port", () => {
  expect(projectCompatibilityDevices([])).toMatchObject({
    ok: true,
    devices: [],
    likely_ports: [],
  });
});
