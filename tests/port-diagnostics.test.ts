/** Focused diagnostics parsing and endpoint validation without accessing serial hardware. */
import { expect, it } from "vitest";
import {
  inspectPortDiagnostics,
  parsePortHolders,
} from "../src/core/devices/port-diagnostics.js";
it("rejects malformed holders, deduplicates PIDs and excludes this process", () => {
  expect(
    parsePortHolders(
      `p${process.pid}\ncself\np9999999999\ncbad\np123\ncserial\u0000app\np123\ncduplicate\np-7\n`,
    ),
  ).toEqual([{ pid: 123, command: "serialapp" }]);
});
it("bounds the number of returned process holders", () => {
  expect(() =>
    parsePortHolders(
      Array.from({ length: 66 }, (_, i) => `p${100000 + i}`).join("\n"),
    ),
  ).toThrow("limit");
});
it("rejects control characters before any device inspection", async () => {
  await expect(inspectPortDiagnostics("COM1\n", null)).rejects.toMatchObject({
    code: "SERIAL_ENDPOINT_INVALID",
  });
});
it.skipIf(process.platform !== "win32")(
  "accepts Windows endpoint forms without claiming holder visibility",
  async () => {
    for (const port of [
      "COM42",
      "com42",
      String.fromCharCode(92, 92, 46, 92) + "COM42",
    ]) {
      expect(await inspectPortDiagnostics(port, null)).toMatchObject({
        exists: null,
        process_check: "unavailable",
        process_check_complete: false,
      });
    }
  },
);
