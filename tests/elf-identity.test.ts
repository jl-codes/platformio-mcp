/** Synthetic headers test ELF identity validation, not physical firmware acceptance. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  retainElfSnapshot,
  resolveRetainedElf,
} from "../src/core/analysis/elf-archive.js";
import { readElfIdentity } from "../src/core/analysis/elf-identity.js";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-elf-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function header(machine: number, bits: 32 | 64 = 32, big = false): Buffer {
  const bytes = Buffer.alloc(128);
  bytes.write("7f454c46", 0, "hex");
  bytes[4] = bits === 32 ? 1 : 2;
  bytes[5] = big ? 2 : 1;
  bytes[6] = 1;
  const u16 = (value: number, offset: number) =>
    big
      ? bytes.writeUInt16BE(value, offset)
      : bytes.writeUInt16LE(value, offset);
  u16(2, 16);
  u16(machine, 18);
  u16(bits === 32 ? 52 : 64, bits === 32 ? 40 : 52);
  if (big) bytes.writeUInt32BE(1, 20);
  else bytes.writeUInt32LE(1, 20);
  return bytes;
}
describe("ELF identity", () => {
  it.each([
    [40, "arm", 32, false],
    [94, "xtensa", 32, false],
    [243, "riscv", 64, false],
    [40, "arm", 32, true],
  ] as const)(
    "reads target %s independently of file naming",
    async (machine, architecture, bits, big) => {
      const file = path.join(root, "firmware 測試.elf");
      const bytes = header(machine, bits, big);
      fs.writeFileSync(file, bytes);
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      expect(await readElfIdentity(file, sha256)).toMatchObject({
        sha256,
        architecture,
        bits,
        byteOrder: big ? "big" : "little",
      });
    },
  );
  it("rejects mismatched content even when the filename is unchanged", async () => {
    const file = path.join(root, "firmware.elf");
    fs.writeFileSync(file, header(94));
    const original = await readElfIdentity(file);
    const changed = header(94);
    changed[100] = 1;
    fs.writeFileSync(file, changed);
    await expect(readElfIdentity(file, original.sha256)).rejects.toMatchObject({
      code: "ANALYSIS_ELF_MISMATCH",
    });
  });
  it("rejects malformed, truncated and relocatable images", async () => {
    const file = path.join(root, "bad.elf");
    for (const bytes of [
      Buffer.alloc(128),
      header(40).subarray(0, 40),
      header(243, 64).subarray(0, 60),
    ]) {
      fs.writeFileSync(file, bytes);
      await expect(readElfIdentity(file)).rejects.toMatchObject({
        code: "ANALYSIS_ELF_INVALID",
      });
    }
    const relocatable = header(40);
    relocatable.writeUInt16LE(1, 16);
    fs.writeFileSync(file, relocatable);
    await expect(readElfIdentity(file)).rejects.toMatchObject({
      code: "ANALYSIS_ELF_INVALID",
    });
  });
});

it("retains distinct content across rebuilds and reuses a verified archived hash", async () => {
  const file = path.join(root, "firmware.elf");
  const archive = path.join(root, "archive");
  const old = header(94);
  fs.writeFileSync(file, old);
  const first = await readElfIdentity(file);
  const retained = await retainElfSnapshot(file, first.sha256, archive);
  const again = await Promise.all(
    Array.from({ length: 3 }, () =>
      retainElfSnapshot(file, first.sha256, archive),
    ),
  );
  expect(new Set(again)).toEqual(new Set([retained]));
  const newer = header(94);
  newer[100] = 42;
  fs.writeFileSync(file, newer);
  const second = await readElfIdentity(file);
  const next = await retainElfSnapshot(file, second.sha256, archive);
  expect(await resolveRetainedElf(file, first.sha256, archive)).toBe(retained);
  fs.unlinkSync(file);
  expect(await resolveRetainedElf(file, first.sha256, archive)).toBe(retained);
  expect(fs.readFileSync(retained)).toEqual(old);
  expect(fs.readFileSync(next)).toEqual(newer);
  expect(fs.readdirSync(path.dirname(retained)).sort()).toEqual(
    [first.sha256 + ".elf", second.sha256 + ".elf"].sort(),
  );
});
it("rejects corrupted archived content without overwriting it", async () => {
  const file = path.join(root, "firmware.elf");
  const archive = path.join(root, "archive");
  fs.writeFileSync(file, header(94));
  const identity = await readElfIdentity(file);
  const retained = await retainElfSnapshot(file, identity.sha256, archive);
  const corrupt = header(40);
  fs.writeFileSync(retained, corrupt);
  await expect(
    retainElfSnapshot(file, identity.sha256, archive),
  ).rejects.toMatchObject({
    code: "ANALYSIS_ELF_MISMATCH",
  });
  expect(fs.readFileSync(retained)).toEqual(corrupt);
  expect(fs.readdirSync(path.dirname(retained))).toEqual([
    identity.sha256 + ".elf",
  ]);
});

it("does not resolve a hash retained only for another source path", async () => {
  const first = path.join(root, "first.elf");
  const second = path.join(root, "second.elf");
  fs.writeFileSync(first, header(94));
  fs.writeFileSync(second, header(94));
  const identity = await readElfIdentity(first);
  const archive = path.join(root, "archive");
  await retainElfSnapshot(first, identity.sha256, archive);
  await expect(
    resolveRetainedElf(second, identity.sha256, archive),
  ).rejects.toThrow();
});

it("returns the same canonical archive path through an aliased ancestor", async () => {
  const file = path.join(root, "firmware.elf");
  const actual = path.join(root, "actual");
  const alias = path.join(root, "alias");
  fs.writeFileSync(file, header(94));
  fs.mkdirSync(actual);
  fs.symlinkSync(
    actual,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  const identity = await readElfIdentity(file);
  const retained = await retainElfSnapshot(
    file,
    identity.sha256,
    path.join(alias, "archive"),
  );
  expect(
    await resolveRetainedElf(
      file,
      identity.sha256,
      path.join(alias, "archive"),
    ),
  ).toBe(retained);
  expect(
    await resolveRetainedElf(
      file,
      identity.sha256,
      path.join(actual, "archive"),
    ),
  ).toBe(retained);
});

it("recovers the exact source history after clean removes its build directory", async () => {
  const build = path.join(root, "build", "esp");
  fs.mkdirSync(build, { recursive: true });
  const file = path.join(build, "firmware.elf");
  fs.writeFileSync(file, header(94));
  const identity = await readElfIdentity(file);
  const archive = path.join(root, "archive");
  const retained = await retainElfSnapshot(file, identity.sha256, archive);
  fs.rmSync(path.join(root, "build"), { recursive: true });
  expect(await resolveRetainedElf(file, identity.sha256, archive)).toBe(
    retained,
  );
  await expect(
    resolveRetainedElf(
      path.join(root, "other", "firmware.elf"),
      identity.sha256,
      archive,
    ),
  ).rejects.toThrow();
});
