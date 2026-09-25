/** Child execution and direct serial sessions must contend on the same canonical endpoint lease. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DeviceLeaseStore } from "../src/core/devices/device-lease.js";
import { resolveSerialEndpoint } from "../src/core/devices/serial-endpoint.js";
import { acquireProcessDeviceCustody } from "../src/core/devices/process-device-custody.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "pio-process-lease-"),
  );
  roots.push(root);
  const inspect = () => ({
    status: "running" as const,
    identity: {
      pid: process.pid,
      platform: process.platform,
      startToken: "fixture",
    },
  });
  const store = new DeviceLeaseStore({ root, inspect });
  const peer = new DeviceLeaseStore({ root, inspect });
  const resolve: typeof resolveSerialEndpoint = (port) =>
    resolveSerialEndpoint(port, { platform: "win32" });
  return { store, peer, resolve, endpoint: resolve("COM9") };
}
it("blocks upload when a direct session owns an alternate spelling of the endpoint", () => {
  const { store, peer, resolve, endpoint } = fixture();
  const direct = peer.acquire(endpoint.resource);
  expect(() =>
    acquireProcessDeviceCustody("\\\\.\\com9", { store, resolve }),
  ).toThrow("already owned");
  peer.release(direct);
});
it("blocks direct sessions until child exit is confirmed", () => {
  const { store, peer, resolve, endpoint } = fixture();
  const custody = acquireProcessDeviceCustody("com9", { store, resolve });
  expect(() => peer.acquire(endpoint.resource)).toThrow("already owned");
  custody.prepareSpawn();
  expect(() => peer.acquire(endpoint.resource)).toThrow(
    "handoff is unresolved",
  );
  custody.releaseAfterExit();
  const direct = peer.acquire(endpoint.resource);
  peer.release(direct);
});
it("does not recover unresolved child custody just because its coordinator appears stale", () => {
  const { store, resolve, endpoint } = fixture();
  const custody = acquireProcessDeviceCustody("COM9", { store, resolve });
  custody.prepareSpawn();
  const persisted = roots.at(-1)!;
  const observer = new DeviceLeaseStore({
    root: persisted,
    inspect: () => ({ status: "absent" }),
  });
  expect(observer.status(endpoint.resource).status).toBe("unknown");
  custody.releaseAfterExit();
});
it("reports failed lease cleanup as pending rather than permitting lock release", () => {
  const { store, resolve } = fixture();
  const custody = acquireProcessDeviceCustody("COM9", { store, resolve });
  custody.prepareSpawn();
  vi.spyOn(store, "release").mockImplementationOnce(() => {
    throw new Error("fixture storage failure");
  });
  expect(() => custody.releaseAfterExit()).toThrow(
    expect.objectContaining({
      code: "DEVICE_CLEANUP_PENDING",
      context: { cleanupPending: true },
    }),
  );
  custody.releaseAfterExit();
});
