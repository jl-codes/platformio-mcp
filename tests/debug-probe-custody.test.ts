/** Real lease-store exclusion persists across probe backend startup and refreshed discovery. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeviceLeaseStore } from "../src/core/devices/device-lease.js";
import { acquireDebugProbeCustody } from "../src/core/devices/debug-probe-custody.js";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "pio-probe-custody-"));
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
