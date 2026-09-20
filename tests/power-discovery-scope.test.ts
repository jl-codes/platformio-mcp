/** Discovery scope cannot be retained or reopened after exhausting its metadata budget. */
import { expect, it, vi } from "vitest";
vi.mock("../src/core/action-dispatcher.js", () => ({
  dispatchAuthorizedAction: async (
    _name: unknown,
    _args: unknown,
    _context: unknown,
    execute: () => Promise<unknown>,
  ) => execute(),
}));
vi.mock("../src/core/policy/revision-guard.js", () => ({
  createPolicyRevisionGuard: () => () => {},
}));
vi.mock("../src/core/serial/serial-backend.js", () => ({
  loadSerialBackend: async () => ({ SerialPort: { list: async () => [] } }),
}));
vi.mock("../src/core/devices/serial-endpoint.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../src/core/devices/serial-endpoint.js")
    >();
  return {
    resolveSerialEndpoint: (port: string) =>
      original.resolveSerialEndpoint(port, { platform: "win32" }),
  };
});
import { withPowerSerialDiscovery } from "../src/core/power/power-serial-discovery.js";
const input = {
  projectDir: process.cwd(),
  meterPort: "COM42",
  dutPort: "COM43",
};
it("allows exactly three snapshots and continues rejecting after exhaustion", async () => {
  await withPowerSerialDiscovery(input, {}, async (read) => {
    for (let i = 0; i < 3; i++) expect(await read()).toEqual([]);
    for (let i = 0; i < 3; i++)
      await expect(read()).rejects.toMatchObject({
        code: "POWER_DISCOVERY_EXPIRED",
      });
  });
});
it("expires retained callbacks when the authorized operation finishes", async () => {
  const read = await withPowerSerialDiscovery(input, {}, async (read) => read);
  await expect(read()).rejects.toMatchObject({
    code: "POWER_DISCOVERY_EXPIRED",
  });
});
