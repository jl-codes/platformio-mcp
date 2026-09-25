/** Discovery permissions apply before any OS inventory backend is invoked. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const serialBackend = vi.hoisted(() => vi.fn(async () => []));
vi.mock("../src/core/devices.js", () => ({ listDevicesCore: serialBackend }));
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
import { approveRequest, getApproval } from "../src/core/policy/approvals.js";
import {
  bindProbeSerialPorts,
  discoverDebugProbes,
  withDebugProbeDiscovery,
} from "../src/core/devices/debug-probe-discovery.js";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-probe-discovery-"));
  vi.stubEnv("PIO_MCP_DATA_DIR", root);
  vi.stubEnv("PIO_MCP_POLICY_FILE", path.join(root, "operator.json"));
  backend.mockClear();
  serialBackend.mockClear();
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
    expect(serialBackend).not.toHaveBeenCalled();
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

it("uses one real startup approval for selection and refresh then expires its capability", async () => {
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: {
        approval_required: ["list_devices"],
        audit_all_agent_actions: false,
      },
    }),
  );
  const blocked = await withDebugProbeDiscovery(
    root,
    undefined,
    {},
    async () => null,
  ).catch((error: unknown) => error);
  expect(blocked).toMatchObject({ code: "APPROVAL_REQUIRED" });
  const id = (
    blocked as { context: { policyDecision: { approvalId: string } } }
  ).context.policyDecision.approvalId;
  approveRequest(id);
  const expiredRead = await withDebugProbeDiscovery(
    root,
    id,
    {},
    async (read) => {
      await read();
      await read();
      await expect(read()).rejects.toMatchObject({
        code: "DEBUG_DISCOVERY_AUTHORITY_INVALID",
      });
      return read;
    },
  );
  expect(backend).toHaveBeenCalledTimes(2);
  expect(getApproval(id)?.status).toBe("consumed");
  await expect(expiredRead()).rejects.toMatchObject({
    code: "DEBUG_DISCOVERY_AUTHORITY_INVALID",
  });
  await expect(
    withDebugProbeDiscovery(root, id, {}, async () => null),
  ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
});
it("does not let an unused discovery callback escape its authorized operation", async () => {
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { audit_all_agent_actions: false },
    }),
  );
  const expired = await withDebugProbeDiscovery(
    root,
    undefined,
    {},
    async (read) => read,
  );
  await expect(expired()).rejects.toMatchObject({
    code: "DEBUG_DISCOVERY_AUTHORITY_INVALID",
  });
  expect(backend).not.toHaveBeenCalled();
});

it("binds serial ports only by complete, unambiguous USB identity", () => {
  const probe = {
    vendorId: "303a",
    productId: "1001",
    serialNumber: "board",
    location: "usb:1",
  };
  const rows = [
    {
      port: "COM7",
      description: "arbitrary",
      hwid: "USB VID:PID=303A:1001 SER=board",
    },
    {
      port: "COM8",
      description: "ESP32",
      hwid: "USB VID:PID=303A:1001 SER=other",
    },
    {
      port: "COM9",
      description: "ESP32",
      hwid: "USB VID:PID=303A:1001 SER=board SER=other",
    },
  ];
  expect(bindProbeSerialPorts([probe], rows)[0].serialPorts).toEqual(["COM7"]);
});
