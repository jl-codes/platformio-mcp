/** Advertised flash verification fields cover all accepted inputs and preserve the legacy workflow. */
import { expect, it, vi } from "vitest";
import { withFlashVerificationTools } from "../src/adapters/flash-verification-registry.js";
import { FlashVerificationCompatibilitySchema } from "../src/adapters/flash-verification-compat.js";
import type { RegisteredTool } from "../src/mcp/tool-registry.js";
const legacy = {
  name: "agent_flash_monitor_verify",
  inputSchema: { type: "object" },
  handler: vi.fn(),
} as unknown as RegisteredTool<unknown>;
const base = new Map([[legacy.name, legacy]]);
it("advertises every accepted field, including connection-local resume and separate grants", () => {
  const canonical = withFlashVerificationTools(base);
  const both = withFlashVerificationTools(canonical, "pio_flash_and_verify");
  const definition = canonical.get("flash_verification")!;
  expect(
    Object.keys(definition.inputSchema.properties as object).sort(),
  ).toEqual(Object.keys(FlashVerificationCompatibilitySchema.shape).sort());
  expect(both.get("pio_flash_and_verify")?.inputSchema).toEqual(
    definition.inputSchema,
  );
  expect(canonical.get(legacy.name)).toBe(legacy);
  expect(canonical.has("pio_flash_and_verify")).toBe(false);
  expect(() => withFlashVerificationTools(canonical)).toThrow();
});
