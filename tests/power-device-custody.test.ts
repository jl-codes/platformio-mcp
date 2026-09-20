/** Exercise meter/DUT exclusion and failed startup rollback against real lease records. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeviceLeaseStore } from "../src/core/devices/device-lease.js";
import { PowerDeviceCustody } from "../src/core/power/power-device-custody.js";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "pio-power-custody-"),
  );
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const meterResource = { kind: "serial" as const, identity: "meter" };
const dutResource = { kind: "serial" as const, identity: "dut" };
function fixture() {
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
  const meter = {
    resources: [meterResource],
    revalidate: vi.fn(async () => {}),
  };
  const dut = { resources: [dutResource], revalidate: vi.fn(async () => {}) };
  return {
    store,
    peer,
    meter,
    dut,
    owner: new PowerDeviceCustody(meter, dut, store),
  };
}
it("holds both resources through handoff and releases only when asked after cleanup", async () => {
  const f = fixture();
  await f.owner.prepareSpawn();
  for (const resource of [meterResource, dutResource]) {
    expect(f.peer.status(resource).status).toBe("unknown");
    expect(() => f.peer.acquire(resource)).toThrow(/handoff is unresolved/);
  }
  expect(f.meter.revalidate).toHaveBeenCalledOnce();
  expect(f.dut.revalidate).toHaveBeenCalledOnce();
  f.owner.releaseAfterExit();
  f.owner.releaseAfterExit();
  for (const resource of [meterResource, dutResource])
    expect(f.peer.status(resource).status).toBe("unclaimed");
});
it("retains partial acquisition for rollback when a peer owns the meter", async () => {
  const f = fixture(),
    occupied = f.peer.acquire(meterResource);
  await expect(f.owner.prepareSpawn()).rejects.toThrow(/already owned/);
  expect(f.peer.status(dutResource).status).toBe("owned");
  f.owner.releaseAfterExit();
  expect(f.peer.status(dutResource).status).toBe("unclaimed");
  expect(f.peer.status(meterResource).status).toBe("owned");
  f.peer.release(occupied);
});
it("does not hand off either resource after identity refresh fails", async () => {
  const f = fixture();
  f.dut.revalidate.mockRejectedValueOnce(new Error("device changed"));
  await expect(f.owner.prepareSpawn()).rejects.toThrow("device changed");
  expect(f.peer.status(meterResource).status).toBe("owned");
  f.owner.releaseAfterExit();
  expect(f.peer.status(meterResource).status).toBe("unclaimed");
});
it("closing during refresh prevents handoff and requires a cleanup retry", async () => {
  const f = fixture();
  let finish!: () => void;
  f.meter.revalidate.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.owner.prepareSpawn();
  expect(f.owner.prepareSpawn()).toBe(pending);
  expect(() => f.owner.releaseAfterExit()).toThrow(/still running/);
  finish();
  await expect(pending).rejects.toMatchObject({ code: "POWER_CUSTODY_CLOSED" });
  f.owner.releaseAfterExit();
  expect(f.peer.status(dutResource).status).toBe("unclaimed");
});
it("rejects binding the meter as its own DUT before acquiring anything", () => {
  const f = fixture();
  expect(() => new PowerDeviceCustody(f.meter, f.meter, f.store)).toThrow(
    /distinct/,
  );
  expect(f.peer.status(meterResource).status).toBe("unclaimed");
});
it("retries only unreleased leases after a release failure", async () => {
  const f = fixture();
  await f.owner.prepareSpawn();
  const original = f.store.release.bind(f.store);
  const release = vi
    .spyOn(f.store, "release")
    .mockImplementationOnce(() => {
      throw new Error("busy filesystem");
    })
    .mockImplementation(original);
  expect(() => f.owner.releaseAfterExit()).toThrow(/incomplete/);
  expect(release).toHaveBeenCalledTimes(2);
  f.owner.releaseAfterExit();
  expect(release).toHaveBeenCalledTimes(3);
  for (const resource of [meterResource, dutResource])
    expect(f.peer.status(resource).status).toBe("unclaimed");
});

it("borrows the exact held DUT resources without reacquiring or releasing the monitor lease", async () => {
  const f = fixture();
  const lease = f.store.acquire(dutResource);
  const hold = {
    projectDir: root,
    resources: [dutResource],
    signal: new AbortController().signal,
    prepareSpawn: vi.fn(async () => {
      f.store.beginHandoff(lease);
    }),
    releaseAfterExit: vi.fn(() => {
      f.store.cancelHandoff(lease);
    }),
  };
  const owner = new PowerDeviceCustody(f.meter, f.dut, f.store, hold);
  await owner.prepareSpawn();
  expect(hold.prepareSpawn).toHaveBeenCalledOnce();
  expect(() => f.peer.acquire(dutResource)).toThrow(/handoff is unresolved/);
  owner.releaseAfterExit();
  expect(f.peer.status(meterResource).status).toBe("unclaimed");
  expect(f.peer.status(dutResource).status).toBe("owned");
  f.store.release(lease);
});
it("rejects a monitor hold for a different DUT before acquiring anything", () => {
  const f = fixture();
  const hold = {
    projectDir: root,
    resources: [{ kind: "serial" as const, identity: "other" }],
    signal: new AbortController().signal,
    prepareSpawn: vi.fn(),
    releaseAfterExit: vi.fn(),
  };
  expect(() => new PowerDeviceCustody(f.meter, f.dut, f.store, hold)).toThrow(
    expect.objectContaining({ code: "POWER_DUT_SCOPE_MISMATCH" }),
  );
  expect(f.peer.status(meterResource).status).toBe("unclaimed");
});
