/** Canonical OTA is available without reference aliases and both share metadata and policy inheritance. */
import { expect, it, vi } from "vitest";
import { withOtaTools } from "../src/adapters/ota-registry.js";
import { policyNamesForOperation } from "../src/core/action-catalog.js";
import type { RegisteredTool } from "../src/mcp/tool-registry.js";
const base = new Map([
  [
    "upload_firmware",
    {
      name: "upload_firmware",
      policyAction: "upload_firmware",
      riskLevel: "high",
      inputSchema: { type: "object" },
      handler: vi.fn(),
    } as unknown as RegisteredTool<unknown>,
  ],
]);
it("adds canonical OTA without modifying the legacy upload or exposing aliases", () => {
  const canonical = withOtaTools(base);
  expect(canonical.get("upload_firmware")).toBe(base.get("upload_firmware"));
  expect(canonical.has("upload_ota")).toBe(true);
  expect(canonical.has("pio_upload_ota")).toBe(false);
  const both = withOtaTools(canonical, "pio_upload_ota");
  expect(both.get("pio_upload_ota")?.inputSchema).toEqual(
    both.get("upload_ota")?.inputSchema,
  );
  expect(() => withOtaTools(canonical)).toThrow();
});
it("keeps canonical and reference denies in firmware and filesystem dispatch", () => {
  for (const operation of ["ota_upload_firmware", "ota_upload_filesystem"])
    expect(policyNamesForOperation(operation)).toEqual(
      expect.arrayContaining(["upload_ota", "pio_upload_ota"]),
    );
  expect(policyNamesForOperation("pio_upload_ota")).toEqual(
    expect.arrayContaining(["upload_ota", "upload_firmware"]),
  );
});
