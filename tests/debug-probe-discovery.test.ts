/** Discovery permissions apply before any OS inventory backend is invoked. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const backend = vi.hoisted(() =>
  vi.fn(async () => ({ devices: [], unidentified: 0, source: "fixture" })),
);
vi.mock("../src/core/devices/linux-usb-probes.js", () => ({
  enumerateLinuxUsbProbes: backend,
}));
vi.mock("../src/core/devices/windows-usb-probes.js", () => ({
  enumerateWindowsUsbProbes: backend,
}));
vi.mock("../src/core/devices/macos-usb-probes.js", () => ({
  enumerateMacosUsbProbes: backend,
}));
import { discoverDebugProbes } from "../src/core/devices/debug-probe-discovery.js";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-probe-discovery-"));
  vi.stubEnv("PIO_MCP_DATA_DIR", root);
  vi.stubEnv("PIO_MCP_POLICY_FILE", path.join(root, "operator.json"));
  backend.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
it.each(["list_devices", "debugger_discover"])(
  "honors %s denial before OS lookup",
  async (action) => {
    fs.writeFileSync(
      path.join(root, "operator.json"),
      JSON.stringify({
        profile: "read_only",
        overrides: { deny: [action], audit_all_agent_actions: false },
      }),
    );
    await expect(discoverDebugProbes(root)).rejects.toMatchObject({
      code: "POLICY_DENIED",
    });
    expect(backend).not.toHaveBeenCalled();
  },
);
it("returns permitted metadata without running a device operation", async () => {
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { audit_all_agent_actions: false },
    }),
  );
  expect(await discoverDebugProbes(root)).toMatchObject({
    devices: [],
    unidentified: 0,
  });
  expect(backend).toHaveBeenCalledOnce();
});
