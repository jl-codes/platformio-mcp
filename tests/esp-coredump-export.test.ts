/** Dump exports preserve exact bytes and refuse destination replacement or workspace escape. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it } from "vitest";
import { exportEspCoredump } from "../src/core/analysis/esp-coredump-export.js";
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pio-dump-export-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it("publishes exact bytes and removes private staging without replacing an existing file", async () => {
  const bytes = Buffer.from([0, 255, 2, 3]);
  const result = await exportEspCoredump(root, "crash.bin", bytes);
  expect(await fs.readFile(result.path)).toEqual(bytes);
  expect(result.retention).toBe("user_managed");
  expect(await fs.readdir(root)).toEqual(["crash.bin"]);
  if (process.platform !== "win32")
    expect((await fs.stat(result.path)).mode & 0o777).toBe(0o600);
  await expect(
    exportEspCoredump(root, "crash.bin", Buffer.from("replacement")),
  ).rejects.toMatchObject({ code: "COREDUMP_EXPORT_EXISTS" });
  expect(await fs.readFile(result.path)).toEqual(bytes);
}, 20000);
it("rejects a destination outside the authorized workspace", async () => {
  await expect(
    exportEspCoredump(root, "../outside.bin", Buffer.from("dump")),
  ).rejects.toMatchObject({ code: "COREDUMP_EXPORT_OUTSIDE_WORKSPACE" });
});
it("rejects oversized exports before creating a destination", async () => {
  await expect(
    exportEspCoredump(root, "large.bin", Buffer.alloc(16 * 1024 * 1024 + 1)),
  ).rejects.toMatchObject({ code: "COREDUMP_EXPORT_INVALID" });
  expect(await fs.readdir(root)).toEqual([]);
});
