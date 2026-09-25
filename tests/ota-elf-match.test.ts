/** Retained ELF correspondence is based on exact bounded bytes, never modification times. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { beforeEach, afterEach, expect, it } from "vitest";
import { matchAndRetainOtaElf } from "../src/core/ota/ota-elf-match.js";
let root: string, project: string, elf: string, bytes: Buffer, hash: string;
beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pio-ota-elf-")),
  );
  project = path.join(root, "project");
  await fs.mkdir(project);
  elf = path.join(project, "firmware.elf");
  bytes = Buffer.alloc(128);
  bytes.write("7f454c46010101", 0, "hex");
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(94, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeUInt16LE(52, 40);
  hash = createHash("sha256").update(bytes).digest("hex");
  await fs.writeFile(elf, bytes);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it("retains matched bytes for decoding after the source ELF is rebuilt", async () => {
  const result = await matchAndRetainOtaElf(
    project,
    elf,
    hash,
    path.join(root, "archive"),
  );
  expect(result).toMatchObject({
    sha256: hash,
    architecture: "xtensa",
    path: elf,
  });
  await fs.writeFile(elf, "later build");
  expect(await fs.readFile(result.archivePath)).toEqual(bytes);
});
it("rejects mismatched and missing embedded identities", async () => {
  await expect(
    matchAndRetainOtaElf(project, elf, "f".repeat(64)),
  ).rejects.toMatchObject({ code: "OTA_ELF_MISMATCH" });
  await expect(matchAndRetainOtaElf(project, elf, null)).rejects.toMatchObject({
    code: "OTA_ELF_IDENTITY_UNAVAILABLE",
  });
});
it("rejects outside-workspace ELF paths before retention", async () => {
  const outside = path.join(root, "outside.elf");
  await fs.writeFile(outside, bytes);
  await expect(
    matchAndRetainOtaElf(project, outside, hash),
  ).rejects.toMatchObject({ code: "PARTITION_ARTIFACT_OUTSIDE_WORKSPACE" });
});
it("rejects matching hashes whose ELF target is not supported", async () => {
  bytes.writeUInt16LE(62, 18);
  await fs.writeFile(elf, bytes);
  await expect(
    matchAndRetainOtaElf(
      project,
      elf,
      createHash("sha256").update(bytes).digest("hex"),
    ),
  ).rejects.toMatchObject({ code: "OTA_ELF_TARGET_INVALID" });
});
