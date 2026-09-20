/** OTA target pinning and cross-alias network exclusion, without contacting a device. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import {
  resolveOtaTarget,
  acquireOtaCustody,
} from "../src/core/devices/ota-target.js";
import { DeviceLeaseStore } from "../src/core/devices/device-lease.js";
it("pins a single DNS address and unifies aliases and OTA ports", async () => {
  const lookup = vi.fn(async () => [{ address: "192.0.2.8", family: 4 }]);
  const a = await resolveOtaTarget("board.local", 3232, lookup);
  const b = await resolveOtaTarget("192.0.2.8", 8266, lookup);
  expect(a.resource).toEqual(b.resource);
  expect(a.address).toBe("192.0.2.8");
  expect(Object.isFrozen(a)).toBe(true);
  expect(lookup).toHaveBeenCalledOnce();
});
it.each([
  "http://board.local",
  "board.local:3232",
  " board.local",
  "board/firmware",
  "0.0.0.0",
  "239.1.1.1",
  "255.255.255.255",
])("rejects an invalid or non-unicast destination %s", async (host) => {
  await expect(resolveOtaTarget(host, 3232)).rejects.toMatchObject({
    code: "OTA_TARGET_INVALID",
  });
});
it("does not guess between multiple DNS addresses", async () => {
  await expect(
    resolveOtaTarget("board.local", 3232, async () => [
      { family: 4, address: "192.0.2.8" },
      { family: 4, address: "192.0.2.9" },
    ]),
  ).rejects.toMatchObject({ code: "OTA_TARGET_AMBIGUOUS" });
});
it("keeps peer upload excluded until confirmed cleanup releases custody", async () => {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "pio-ota-lease-"),
  );
  try {
    const store = new DeviceLeaseStore({ root });
    const target = await resolveOtaTarget("192.0.2.8", 3232);
    const custody = acquireOtaCustody(target, store);
    await custody.prepareSpawn();
    expect(() => acquireOtaCustody(target, store)).toThrow();
    custody.releaseAfterExit();
    const next = acquireOtaCustody(target, store);
    next.releaseAfterExit();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
