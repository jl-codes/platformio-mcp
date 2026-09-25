/** Managed retention verifies exact bytes, expiry and a serialized object-count limit. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it } from "vitest";
import {
  retainEspCoredump,
  startCoredumpRetentionCleanup,
  pruneRetainedEspCoredumps,
} from "../src/core/analysis/esp-coredump-retention.js";
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pio-retained-core-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it("retains exact bytes privately and removes them at the expiry boundary", async () => {
  const now = Date.now();
  const bytes = Buffer.from([0, 255, 3]);
  const saved = await retainEspCoredump(bytes, root, now);
  expect(await fs.readFile(saved.path)).toEqual(bytes);
  expect(saved.expiresAt).toBe(now + 86400000);
  expect(await pruneRetainedEspCoredumps(root, saved.expiresAt - 1)).toBe(1);
  expect(await pruneRetainedEspCoredumps(root, saved.expiresAt)).toBe(0);
  await expect(fs.stat(saved.path)).rejects.toMatchObject({ code: "ENOENT" });
}, 20000);
it("refuses a 33rd unexpired entry without removing valid retained objects", async () => {
  const now = Date.now();
  for (let i = 0; i < 32; i++) {
    const directory = path.join(
      root,
      "pio-private-analysis-" + String(i).padStart(6, "0"),
    );
    await fs.mkdir(directory);
    await fs.writeFile(
      path.join(directory, "record.json"),
      JSON.stringify({ createdAt: now, expiresAt: now + 86400000 }),
    );
  }
  await expect(
    retainEspCoredump(Buffer.from("dump"), root, now),
  ).rejects.toMatchObject({ code: "COREDUMP_STORE_FULL" });
  expect((await fs.readdir(root)).length).toBe(32);
});
it("does not prune unrelated files in the store", async () => {
  await fs.writeFile(path.join(root, "unrelated.txt"), "keep");
  expect(await pruneRetainedEspCoredumps(root)).toBe(0);
  expect(await fs.readFile(path.join(root, "unrelated.txt"), "utf8")).toBe(
    "keep",
  );
});

it("sweeps expired files on startup and provides a shutdown hook", async () => {
  const saved = await retainEspCoredump(
    Buffer.from("expired"),
    root,
    Date.now() - 86400001,
  );
  const failures: string[] = [];
  const stop = await startCoredumpRetentionCleanup(
    (code) => failures.push(code),
    root,
  );
  try {
    await expect(fs.stat(saved.path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(failures).toEqual([]);
  } finally {
    await stop();
  }
}, 20000);
it("reports a corrupt retention record without deleting unrelated data", async () => {
  const directory = path.join(root, "pio-private-analysis-ABC123");
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, "record.json"), "invalid");
  const failures: string[] = [];
  const stop = await startCoredumpRetentionCleanup(
    (code) => failures.push(code),
    root,
  );
  try {
    expect(failures).toEqual(["COREDUMP_STORE_INVALID"]);
  } finally {
    await stop();
  }
  expect(await fs.readFile(path.join(directory, "record.json"), "utf8")).toBe(
    "invalid",
  );
});
