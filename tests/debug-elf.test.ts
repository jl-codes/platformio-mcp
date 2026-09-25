/** Real ELF snapshots survive rebuilds and uncertain debugger cleanup. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  retainDebugElf,
  ownDebugElf,
  type DebugElfLease,
} from "../src/core/debug/debug-elf.js";
import type { OwnedDebugProcess } from "../src/core/debug/debug-client-sessions.js";
let root: string, project: string, elf: string;
let lease: DebugElfLease | undefined;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pio-debug-elf-"));
  project = path.join(root, "project");
  await fs.mkdir(project);
  elf = path.join(project, "firmware.elf");
  const bytes = Buffer.alloc(128);
  bytes.write("7f454c46", 0, "hex");
  bytes[4] = 1;
  bytes[5] = 1;
  bytes[6] = 1;
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(40, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeUInt16LE(52, 40);
  await fs.writeFile(elf, bytes);
});
afterEach(async () => {
  await lease?.release();
  lease = undefined;
  await fs.rm(root, { recursive: true, force: true });
});
it("holds exact bytes independently of a project rebuild until released", async () => {
  const original = await fs.readFile(elf);
  lease = await retainDebugElf(project, elf);
  await fs.writeFile(elf, "rebuilt");
  expect(await fs.readFile(lease.path)).toEqual(original);
  expect(lease.identity.path).toBe(await fs.realpath(elf));
  const snapshot = lease.path;
  await Promise.all([lease.release(), lease.release()]);
  await expect(fs.access(snapshot)).rejects.toMatchObject({ code: "ENOENT" });
});
it("rejects outside-workspace artifacts and mismatching selected identities", async () => {
  const outside = path.join(root, "outside.elf");
  await fs.copyFile(elf, outside);
  await expect(retainDebugElf(project, outside)).rejects.toMatchObject({
    code: "DEBUG_ELF_OUTSIDE_WORKSPACE",
  });
  await expect(
    retainDebugElf(project, elf, "0".repeat(64)),
  ).rejects.toMatchObject({ code: "ANALYSIS_ELF_MISMATCH" });
});
it("retains the snapshot until probe cleanup succeeds", async () => {
  lease = await retainDebugElf(project, elf);
  const process = {
    command: vi.fn<OwnedDebugProcess["command"]>(),
    state: vi.fn<OwnedDebugProcess["state"]>(),
    cleanupProcess: vi
      .fn(async () => {})
      .mockRejectedValueOnce(new Error("pending")),
  };
  const owned = ownDebugElf(process, lease);
  await expect(owned.cleanupProcess()).rejects.toThrow("pending");
  await fs.access(lease.path);
  await owned.cleanupProcess();
  await expect(fs.access(lease.path)).rejects.toMatchObject({ code: "ENOENT" });
});
