/** Final artifact capture survives rebuilds and rejects stale, mismatched or tampered image sets. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { captureEspUploadManifest } from "../src/core/analysis/esptool-upload-manifest.js";
import {
  captureUploadManifest,
  type UploadManifestInput,
} from "../src/core/analysis/upload-manifest.js";
let root: string, project: string, archive: string, input: UploadManifestInput;
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function app(elfHash: string) {
  const bytes = Buffer.alloc(304);
  bytes[0] = 0xe9;
  bytes[1] = 1;
  bytes.writeUInt32LE(256, 28);
  bytes.writeUInt32LE(0xabcd5432, 32);
  Buffer.from(elfHash, "hex").copy(bytes, 176);
  let checksum = 0xef;
  for (const byte of bytes.subarray(32, 288)) checksum ^= byte;
  bytes[303] = checksum;
  return bytes;
}
// A complete retention assertion creates several owner-only directories. Each Windows ACL
// helper has its own 15-second limit; allow the composed operation to finish before teardown.
describe("retained upload archives", { timeout: 120000 }, () => {
  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "pio-upload-manifest-")),
    );
    project = path.join(root, "project");
    archive = path.join(root, "archive");
    await fs.mkdir(project);
    const elf = Buffer.alloc(128);
    elf.write("7f454c46010101", 0, "hex");
    elf.writeUInt16LE(2, 16);
    elf.writeUInt16LE(94, 18);
    elf.writeUInt32LE(1, 20);
    elf.writeUInt16LE(52, 40);
    const image = app(hash(elf));
    const boot = Buffer.from("boot");
    input = {
      projectDir: project,
      environment: "esp32",
      toolchain: { id: "xtensa-esp32-elf", version: "test-fixture" },
      buildSettingsSha256: hash(Buffer.from("settings")),
      elf: { path: path.join(project, "firmware.elf"), sha256: hash(elf) },
      images: [
        {
          path: path.join(project, "firmware.bin"),
          offset: 0x10000,
          sha256: hash(image),
          role: "application",
        },
        {
          path: path.join(project, "boot.bin"),
          offset: 0x1000,
          sha256: hash(boot),
          role: "bootloader",
        },
      ],
    };
    await fs.writeFile(input.elf.path, elf);
    await fs.writeFile(input.images[0].path, image);
    await fs.writeFile(input.images[1].path, boot);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  it("retains a deterministic complete image/ELF record after later builds remove originals", async () => {
    const saved = await captureUploadManifest(input, archive);
    expect(saved.manifest.elfCorrespondence).toBe("embedded_hash_match");
    expect(saved.manifest.images.map((image) => image.offset)).toEqual([
      0x1000, 0x10000,
    ]);
    expect((await captureUploadManifest(input, archive)).sha256).toBe(
      saved.sha256,
    );
    saved.manifest.images[0].offset = 0;
    expect(saved.manifest.images[0].offset).toBe(0x1000);
    await fs.rm(project, { recursive: true });
    await saved.verify();
    expect(hash(await fs.readFile(saved.path))).toBe(saved.sha256);
    expect(hash(await fs.readFile(saved.manifest.elf.archivePath))).toBe(
      input.elf.sha256,
    );
  });
  it("rejects an image changed while an upload was queued", async () => {
    await fs.writeFile(input.images[0].path, "later build");
    await expect(captureUploadManifest(input, archive)).rejects.toMatchObject({
      code: "OTA_IMAGE_CHANGED",
    });
  });
  it("rejects an application image with another ELF hash", async () => {
    const bytes = app("12".repeat(32));
    await fs.writeFile(input.images[0].path, bytes);
    input.images[0].sha256 = hash(bytes);
    await expect(captureUploadManifest(input, archive)).rejects.toMatchObject({
      code: "UPLOAD_ELF_MISMATCH",
    });
  });
  it("does not call a mixed set fully matched when an application lacks embedded identity", async () => {
    input.images[1].role = "application";
    expect(
      (await captureUploadManifest(input, archive)).manifest.elfCorrespondence,
    ).toBe("identity_unverified");
  });
  it("rejects overlapping flash ranges", async () => {
    input.images[1].offset = input.images[0].offset + 1;
    await expect(captureUploadManifest(input, archive)).rejects.toMatchObject({
      code: "UPLOAD_MANIFEST_INVALID",
    });
  });
  it.each(["image", "manifest", "elf"])(
    "rejects retained %s tampering before execution",
    async (kind) => {
      const saved = await captureUploadManifest(input, archive);
      const target =
        kind === "image"
          ? saved.manifest.images[0].archivePath
          : kind === "elf"
            ? saved.manifest.elf.archivePath
            : saved.path;
      await fs.writeFile(target, "tampered");
      await expect(saved.verify()).rejects.toThrow();
    },
  );

  it("binds final argv to retained inputs and preserves all non-image arguments", async () => {
    const argv = [
      "python",
      "esptool.py",
      "--port",
      "COM42",
      "write_flash",
      "-z",
      "0x10000",
      input.images[0].path,
      "0x1000",
      input.images[1].path,
    ];
    const saved = await captureEspUploadManifest(input, argv, archive);
    expect(saved.manifest.uploadCommandSha256).toBe(
      hash(Buffer.from(JSON.stringify(argv))),
    );
    expect(saved.arguments[7]).toBe(saved.manifest.images[1].archivePath);
    expect(saved.arguments[9]).toBe(saved.manifest.images[0].archivePath);
    expect(saved.arguments.slice(0, 7)).toEqual(argv.slice(0, 7));
    saved.arguments[7] = "tampered";
    expect(saved.arguments[7]).not.toBe("tampered");
    await fs.rm(project, { recursive: true });
    await saved.verify();
  });
  it("rejects a final uploader operand omitted from or inconsistent with the manifest", async () => {
    const argv = ["esptool.py", "write_flash", "0x10000", input.images[0].path];
    await expect(
      captureEspUploadManifest(input, argv, archive),
    ).rejects.toMatchObject({ code: "UPLOAD_MANIFEST_INVALID" });
    argv.push("0x1000", input.images[0].path);
    await expect(
      captureEspUploadManifest(input, argv, archive),
    ).rejects.toMatchObject({ code: "UPLOAD_MANIFEST_INVALID" });
  });

  it("allows external boot images only under explicitly trusted package roots", async () => {
    const packageRoot = path.join(root, "registered-package");
    await fs.mkdir(packageRoot);
    const external = path.join(packageRoot, "boot.bin");
    await fs.copyFile(input.images[1].path, external);
    input.images[1].path = external;
    await expect(captureUploadManifest(input, archive)).rejects.toMatchObject({
      code: "PARTITION_ARTIFACT_OUTSIDE_WORKSPACE",
    });
    const saved = await captureUploadManifest(input, archive, [packageRoot]);
    expect(saved.manifest.images[0].sourcePath).toBe(
      await fs.realpath(external),
    );
    await fs.rm(packageRoot, { recursive: true });
    await saved.verify();
  });

  it("binds a capture record to host context before retaining its exact upload operands", async () => {
    const { retainUploadCapture } =
      await import("../src/core/analysis/upload-capture-record.js");
    const captureDirectory = path.join(root, "capture");
    await fs.mkdir(captureDirectory);
    const recordPath = path.join(captureDirectory, "selection.json");
    const pythonPath = process.execPath;
    const esptoolPath = path.join(root, "esptool.py");
    await fs.writeFile(esptoolPath, "# fixture only");
    const uploader = { pythonPath, esptoolPath, chip: "esp32", port: "COM7" };
    const argv = [
      pythonPath,
      esptoolPath,
      "--chip",
      "esp32",
      "--port",
      "COM7",
      "write_flash",
      ...input.images.flatMap((image) => [String(image.offset), image.path]),
    ];
    const record = {
      schemaVersion: 1,
      captureOnly: true,
      commandLine: "captured display text",
      argv,
      projectDir: project,
      environment: input.environment,
      compiler: "verified compiler",
      buildSettingsSha256: input.buildSettingsSha256,
      elf: { ...input.elf, size: (await fs.stat(input.elf.path)).size },
      images: await Promise.all(
        input.images.map(async (image) => ({
          ...image,
          size: (await fs.stat(image.path)).size,
        })),
      ),
    };
    await fs.writeFile(recordPath, JSON.stringify(record));
    const context = {
      captureDirectory,
      projectDir: project,
      environment: input.environment,
      compiler: record.compiler,
      toolchain: input.toolchain,
      uploader,
    };
    await expect(
      retainUploadCapture(
        recordPath,
        { ...context, environment: "other" },
        archive,
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_CAPTURE_CONTEXT_CHANGED" });
    await expect(fs.stat(archive)).rejects.toMatchObject({ code: "ENOENT" });
    const saved = await retainUploadCapture(recordPath, context, archive);
    expect(saved.manifest.elfCorrespondence).toBe("embedded_hash_match");
    expect(saved.arguments).not.toContain(input.images[0].path);
    await fs.rm(project, { recursive: true });
    await saved.verify();
  });
});
