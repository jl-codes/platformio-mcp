/** Real lease-store exclusion persists across probe backend startup and refreshed discovery. */
import fs from "node:fs";
import { resolveSerialEndpoint } from "../src/core/devices/serial-endpoint.js";
import { acquireProcessDeviceCustody } from "../src/core/devices/process-device-custody.js";
import { bindSerialDiscovery } from "../src/core/devices/serial-discovery-binding.js";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeviceLeaseStore } from "../src/core/devices/device-lease.js";
import { acquireDebugProbeCustody } from "../src/core/devices/debug-probe-custody.js";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "pio-probe-custody-"),
  );
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const probe = {
  vendorId: "1366",
  productId: "0101",
  serialNumber: "probe",
  location: "usb:1-2",
};
function stores() {
  const inspect = () => ({
    status: "running" as const,
    identity: {
      pid: process.pid,
      platform: process.platform,
      startToken: "fixture",
    },
  });
  return {
    store: new DeviceLeaseStore({ root, inspect }),
    peer: new DeviceLeaseStore({ root, inspect }),
  };
}
it("excludes another backend until confirmed cleanup", async () => {
  const { store, peer } = stores(),
    enumerate = vi.fn(async () => [probe]);
  const held = await acquireDebugProbeCustody(enumerate, {}, store);
  expect(() => peer.acquire(held.resource)).toThrow(/already owned/);
  await held.custody.prepareSpawn();
  expect(enumerate).toHaveBeenCalledTimes(2);
  expect(() => peer.acquire(held.resource)).toThrow(/handoff is unresolved/);
  held.custody.releaseAfterExit();
  const next = peer.acquire(held.resource);
  peer.release(next);
});
it("refuses to spawn after the selected probe disappears", async () => {
  const { store, peer } = stores(),
    enumerate = vi.fn(async () => [probe]);
  const held = await acquireDebugProbeCustody(enumerate, {}, store);
  enumerate.mockResolvedValueOnce([]);
  await expect(held.custody.prepareSpawn()).rejects.toMatchObject({
    code: "DEBUG_PROBE_NOT_FOUND",
  });
  held.custody.releaseAfterExit();
  const next = peer.acquire(held.resource);
  peer.release(next);
});
it("retains uncertain probe custody after coordinator loss", async () => {
  const { store } = stores();
  const held = await acquireDebugProbeCustody(async () => [probe], {}, store);
  await held.custody.prepareSpawn();
  const observer = new DeviceLeaseStore({
    root,
    inspect: () => ({ status: "absent" }),
  });
  expect(observer.status(held.resource).status).toBe("unknown");
  held.custody.releaseAfterExit();
});

it("excludes same-device legacy uploads and serial USB leases until confirmed cleanup", async () => {
  const { store, peer } = stores();
  const resolve = (port: string) =>
    resolveSerialEndpoint(port, { platform: "win32" });
  const selected = { ...probe, serialPorts: ["COM7"] };
  const held = await acquireDebugProbeCustody(
    async () => [selected],
    {},
    store,
    resolve,
  );
  const binding = bindSerialDiscovery(
    resolve("COM7"),
    [{ path: "COM7", ...probe }],
    resolve,
  );
  const usb = { kind: "serial" as const, identity: binding.usbIdentity! };
  expect(() =>
    acquireProcessDeviceCustody("com7", { store: peer, resolve }),
  ).toThrow(/already owned/);
  expect(() => peer.acquire(usb)).toThrow(/already owned/);
  await held.custody.prepareSpawn();
  expect(() =>
    acquireProcessDeviceCustody("COM7", { store: peer, resolve }),
  ).toThrow(/handoff is unresolved/);
  held.custody.releaseAfterExit();
  const upload = acquireProcessDeviceCustody("COM7", { store: peer, resolve });
  upload.releaseAfterExit();
  peer.release(peer.acquire(usb));
});

it("rolls back partial probe acquisition when a serial upload already owns the endpoint", async () => {
  const { store, peer } = stores();
  const resolve = (port: string) =>
    resolveSerialEndpoint(port, { platform: "win32" });
  const upload = acquireProcessDeviceCustody("COM7", { store: peer, resolve });
  await expect(
    acquireDebugProbeCustody(
      async () => [{ ...probe, serialPorts: ["COM7"] }],
      {},
      store,
      resolve,
    ),
  ).rejects.toMatchObject({ code: "DEVICE_BUSY" });
  upload.releaseAfterExit();
  const held = await acquireDebugProbeCustody(
    async () => [{ ...probe, serialPorts: ["COM7"] }],
    {},
    store,
    resolve,
  );
  held.custody.releaseAfterExit();
});

it("rejects endpoint substitution before backend handoff", async () => {
  const { store } = stores();
  const resolve = (port: string) =>
    resolveSerialEndpoint(port, { platform: "win32" });
  const enumerate = vi.fn(async () => [{ ...probe, serialPorts: ["COM7"] }]);
  const held = await acquireDebugProbeCustody(enumerate, {}, store, resolve);
  enumerate.mockResolvedValueOnce([{ ...probe, serialPorts: ["COM8"] }]);
  await expect(held.custody.prepareSpawn()).rejects.toMatchObject({
    code: "DEBUG_PROBE_CHANGED",
  });
  held.custody.releaseAfterExit();
});
