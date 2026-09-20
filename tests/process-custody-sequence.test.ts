/** Sequential upload children keep device exclusion until every process closure is confirmed. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { expect, it, vi } from "vitest";
import { DeviceLeaseStore } from "../src/core/devices/device-lease.js";
import { ProcessCustodySequence } from "../src/core/devices/process-custody-sequence.js";

it("keeps a real lease held between capture and upload, releasing it only after both close", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-sequence-"));
  try {
    const store = new DeviceLeaseStore({
      root,
      inspect: (pid) => ({
        status: "running",
        identity: { pid, platform: process.platform, startToken: "fixture" },
      }),
    });
    const resource = { kind: "serial" as const, identity: "fixture:serial" };
    const lease = store.acquire(resource);
    const parent = {
      prepareSpawn: vi.fn(() => store.beginHandoff(lease)),
      releaseAfterExit: vi.fn(() => {
        store.cancelHandoff(lease);
        store.release(lease);
      }),
    };
    const revalidate = vi.fn();
    const sequence = new ProcessCustodySequence(parent, revalidate);
    const capture = sequence.nextPhase();
    await capture.prepareSpawn();
    capture.releaseAfterExit();
    expect(parent.releaseAfterExit).not.toHaveBeenCalled();
    expect(() => store.acquire(resource)).toThrow();
    const upload = sequence.nextPhase();
    await upload.prepareSpawn();
    expect(parent.prepareSpawn).toHaveBeenCalledTimes(1);
    expect(revalidate).toHaveBeenCalledTimes(2);
    expect(() => sequence.nextPhase()).toThrow();
    expect(() => sequence.finish()).toThrow("unconfirmed");
    expect(() => store.acquire(resource)).toThrow();
    upload.releaseAfterExit();
    sequence.finish();
    sequence.finish();
    expect(parent.releaseAfterExit).toHaveBeenCalledTimes(1);
    expect(store.status(resource).status).toBe("unclaimed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
it("retains ownership while an asynchronous preparation is pending", async () => {
  let proceed!: () => void;
  const parent = { prepareSpawn: vi.fn(), releaseAfterExit: vi.fn() };
  const sequence = new ProcessCustodySequence(
    parent,
    () =>
      new Promise<void>((resolve) => {
        proceed = resolve;
      }),
  );
  const phase = sequence.nextPhase();
  const preparing = phase.prepareSpawn();
  expect(() => phase.releaseAfterExit()).toThrow("still running");
  expect(() => sequence.finish()).toThrow("unconfirmed");
  expect(parent.releaseAfterExit).not.toHaveBeenCalled();
  proceed();
  await expect(preparing).rejects.toThrow("closed before spawn");
  expect(parent.prepareSpawn).not.toHaveBeenCalled();
  phase.releaseAfterExit();
  sequence.finish();
  expect(parent.releaseAfterExit).toHaveBeenCalledOnce();
});
it("does not let a failed later device check reuse an earlier successful preparation", async () => {
  const parent = { prepareSpawn: vi.fn(), releaseAfterExit: vi.fn() };
  const check = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("device changed"));
  const sequence = new ProcessCustodySequence(parent, check);
  const first = sequence.nextPhase();
  await first.prepareSpawn();
  first.releaseAfterExit();
  const second = sequence.nextPhase();
  await expect(second.prepareSpawn()).rejects.toThrow("device changed");
  second.releaseAfterExit();
  expect(() => sequence.nextPhase()).toThrow();
  sequence.finish();
  await expect(first.prepareSpawn()).rejects.toThrow();
});
it("keeps failed parent cleanup retryable and prevents another phase", () => {
  const parent = {
    prepareSpawn: vi.fn(),
    releaseAfterExit: vi.fn().mockImplementationOnce(() => {
      throw new Error("storage unavailable");
    }),
  };
  const sequence = new ProcessCustodySequence(parent, () => {});
  expect(() => sequence.finish()).toThrow("storage unavailable");
  expect(() => sequence.nextPhase()).toThrow();
  sequence.finish();
  expect(parent.releaseAfterExit).toHaveBeenCalledTimes(2);
});
