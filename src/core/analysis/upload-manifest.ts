/** Capture final uploader-selected binaries and ELF into retained content-addressed history. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { SERVER_DATA_DIR } from "../../utils/paths.js";
import { PlatformIOError } from "../../utils/errors.js";
import { readPartitionArtifact } from "../esp-partition-artifacts.js";
import { retainOtaImage } from "../ota/ota-artifacts.js";
import { retainElfSnapshot } from "./elf-archive.js";
import { createPrivateAnalysisDirectory } from "./private-analysis-directory.js";
import { readElfIdentity } from "./elf-identity.js";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const InputSchema = z
  .object({
    projectDir: z.string().min(1),
    environment: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),
    toolchain: z
      .object({
        id: z.string().min(1).max(256),
        version: z.string().min(1).max(128),
      })
      .strict(),
    buildSettingsSha256: HashSchema,
    uploadCommandSha256: HashSchema.optional(),
    elf: z.object({ path: z.string().min(1), sha256: HashSchema }).strict(),
    images: z
      .array(
        z
          .object({
            path: z.string().min(1),
            sha256: HashSchema,
            offset: z.number().int().min(0).max(0xffffffff),
            role: z.enum([
              "application",
              "bootloader",
              "partition-table",
              "data",
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict();

/** Host input from final uploader selection; this is not an execution API or an authorization grant. */
export type UploadManifestInput = z.input<typeof InputSchema>;

/**
 * Preserve final expected bytes and offsets. The caller must upload these retained paths, reverify
 * before writing, and authorize the manifest hash; capture alone never proves a completed upload.
 */
export async function captureUploadManifest(
  input: UploadManifestInput,
  archiveRoot?: string,
  trustedImageRoots: readonly string[] = [], // Host-verified registered package roots, never MCP arguments.
) {
  const elfArchiveRoot =
    archiveRoot === undefined ? undefined : path.join(archiveRoot, "elf");
  archiveRoot ??= path.join(SERVER_DATA_DIR, "artifacts", "upload");
  const args = InputSchema.parse(input);
  const selectedRoots = [...trustedImageRoots];
  if (
    selectedRoots.length > 128 ||
    selectedRoots.some((root) => !path.isAbsolute(root))
  )
    throw new PlatformIOError(
      "Invalid trusted upload image roots.",
      "UPLOAD_MANIFEST_INVALID",
    );
  const projectDir = await fs.realpath(args.projectDir);
  const imageRoots = [projectDir];
  for (const selected of selectedRoots) {
    const root = await fs.realpath(selected);
    if (!(await fs.stat(root)).isDirectory())
      throw new PlatformIOError(
        "Upload image root must be a directory.",
        "UPLOAD_MANIFEST_INVALID",
      );
    imageRoots.push(root);
  }
  const privateRoot = await fs.realpath(await createPrivateAnalysisDirectory());
  try {
    const elfSource = await readPartitionArtifact(
      projectDir,
      args.elf.path,
      256 * 1024 * 1024,
    );
    if (elfSource.identity.sha256 !== args.elf.sha256)
      throw new PlatformIOError(
        "ELF changed before upload capture.",
        "UPLOAD_ARTIFACT_CHANGED",
      );
    const elfSnapshot = path.join(privateRoot, "firmware.elf");
    await fs.writeFile(elfSnapshot, elfSource.content, {
      flag: "wx",
      mode: 0o600,
    });
    const elfIdentity = await readElfIdentity(elfSnapshot, args.elf.sha256);
    const elfPath = await retainElfSnapshot(
      elfSnapshot,
      args.elf.sha256,
      elfArchiveRoot,
      elfSource.identity.path,
    );
    const images: Array<{
      sourcePath: string;
      archivePath: string;
      sha256: string;
      size: number;
      offset: number;
      role: z.infer<typeof InputSchema>["images"][number]["role"];
    }> = [];
    let bytes = 0;
    let previousEnd = 0;
    let applicationCount = 0;
    let matchedApplications = 0;
    for (const selected of [...args.images].sort(
      (a, b) => a.offset - b.offset,
    )) {
      const sourcePath = await fs.realpath(
        path.resolve(projectDir, selected.path),
      );
      const sourceRoot = imageRoots.find((root) => {
        const relative = path.relative(root, sourcePath);
        return (
          relative !== ".." &&
          !relative.startsWith(".." + path.sep) &&
          !path.isAbsolute(relative)
        );
      });
      if (!sourceRoot)
        throw new PlatformIOError(
          "Upload image is outside the project and trusted packages.",
          "PARTITION_ARTIFACT_OUTSIDE_WORKSPACE",
        );
      const image = await retainOtaImage(
        sourceRoot,
        sourcePath,
        selected.sha256,
        path.join(archiveRoot, "images"),
      );
      try {
        const end = selected.offset + image.identity.size;
        bytes += image.identity.size;
        if (
          selected.offset < previousEnd ||
          end > 0x100000000 ||
          bytes > 128 * 1024 * 1024
        )
          throw new PlatformIOError(
            "Upload image ranges overlap or exceed capture limits.",
            "UPLOAD_MANIFEST_INVALID",
          );
        previousEnd = end;
        if (selected.role === "application") applicationCount++;
        if (
          selected.role === "application" &&
          image.identity.embeddedElfSha256
        ) {
          if (image.identity.embeddedElfSha256 !== elfIdentity.sha256)
            throw new PlatformIOError(
              "Application image does not match the selected ELF.",
              "UPLOAD_ELF_MISMATCH",
            );
          matchedApplications++;
        }
        images.push({
          sourcePath: image.identity.sourcePath,
          archivePath: await image.archive(),
          sha256: image.identity.sha256,
          size: image.identity.size,
          offset: selected.offset,
          role: selected.role,
        });
      } finally {
        await image.release();
      }
    }
    const manifest = {
      schemaVersion: 1,
      projectDir,
      environment: args.environment,
      toolchain: args.toolchain,
      buildSettingsSha256: args.buildSettingsSha256,
      ...(args.uploadCommandSha256
        ? { uploadCommandSha256: args.uploadCommandSha256 }
        : {}),
      elf: {
        sourcePath: elfSource.identity.path,
        archivePath: elfPath,
        sha256: elfIdentity.sha256,
        size: elfIdentity.size,
      },
      images,
      elfCorrespondence:
        applicationCount > 0 && matchedApplications === applicationCount
          ? "embedded_hash_match"
          : "identity_unverified",
    };
    const encoded = JSON.stringify(manifest);
    if (Buffer.byteLength(encoded) > 2 * 1024 * 1024)
      throw new PlatformIOError(
        "Upload manifest is too large.",
        "UPLOAD_MANIFEST_INVALID",
      );
    const sha256 = createHash("sha256").update(encoded).digest("hex");
    const directory = path.join(archiveRoot, "manifests");
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const state = await fs.lstat(directory);
    if (!state.isDirectory() || state.isSymbolicLink())
      throw new PlatformIOError(
        "Invalid upload manifest archive.",
        "UPLOAD_MANIFEST_INVALID",
      );
    const root = await fs.realpath(directory);
    const destination = path.join(root, sha256 + ".json");
    const temporary = path.join(root, "." + randomUUID() + ".tmp");
    try {
      await fs.writeFile(temporary, encoded, { flag: "wx", mode: 0o600 });
      try {
        await fs.link(temporary, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const saved = await fs.lstat(destination);
      if (
        !saved.isFile() ||
        saved.isSymbolicLink() ||
        (await readPartitionArtifact(root, destination, 2 * 1024 * 1024))
          .identity.sha256 !== sha256
      )
        throw new PlatformIOError(
          "Retained upload manifest changed.",
          "UPLOAD_MANIFEST_INVALID",
        );
    } finally {
      await fs.unlink(temporary);
    }
    return {
      get manifest() {
        return JSON.parse(encoded) as typeof manifest;
      },
      sha256,
      path: destination,
      async verify() {
        const stored = await readPartitionArtifact(
          root,
          destination,
          2 * 1024 * 1024,
        );
        if (stored.identity.sha256 !== sha256)
          throw new PlatformIOError(
            "Upload manifest changed before execution.",
            "UPLOAD_ARTIFACT_CHANGED",
          );
        await readElfIdentity(elfPath, elfIdentity.sha256);
        for (const image of images) {
          const storedImage = await readPartitionArtifact(
            path.dirname(image.archivePath),
            image.archivePath,
            64 * 1024 * 1024,
          );
          if (
            storedImage.identity.sha256 !== image.sha256 ||
            storedImage.identity.size !== image.size
          )
            throw new PlatformIOError(
              "Upload image changed before execution.",
              "UPLOAD_ARTIFACT_CHANGED",
            );
        }
      },
    };
  } finally {
    await fs.rm(privateRoot, { recursive: true, force: true });
  }
}
