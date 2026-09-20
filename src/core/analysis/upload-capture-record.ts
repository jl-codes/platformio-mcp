/** Read bounded SCons capture records and bind their artifact selection to retained manifests. */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readPartitionArtifact } from "../esp-partition-artifacts.js";
import { PlatformIOError } from "../../utils/errors.js";
import { captureEspUploadManifest } from "./esptool-upload-manifest.js";
import {
  validateEspUploadCommand,
  type EspUploadCommandContext,
} from "./esptool-upload-command.js";
import type { UploadManifestInput } from "./upload-manifest.js";

const FileSchema = z
  .object({
    path: z.string().min(1).refine(path.isAbsolute),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().positive(),
  })
  .strict();
const RecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    captureOnly: z.literal(true),
    commandLine: z
      .string()
      .min(1)
      .max(1024 * 1024),
    argv: z
      .array(
        z
          .string()
          .min(1)
          .max(1024 * 1024)
          .regex(/^[^\x00-\x1f\x7f]+$/),
      )
      .min(1)
      .max(256),
    projectDir: z.string().min(1).refine(path.isAbsolute),
    environment: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),
    compiler: z.string().min(1).max(4096),
    buildSettingsSha256: z.string().regex(/^[a-f0-9]{64}$/),
    elf: FileSchema,
    images: z
      .array(
        FileSchema.extend({
          offset: z.number().int().min(0).max(0xffffffff),
          role: z.enum([
            "application",
            "bootloader",
            "partition-table",
            "data",
          ]),
        }).strict(),
      )
      .min(1)
      .max(32),
  })
  .strict();

/** Host-selected capture context; compiler and toolchain come from verified build metadata. */
export interface UploadCaptureContext {
  captureDirectory: string;
  projectDir: string;
  environment: string;
  compiler: string;
  toolchain: UploadManifestInput["toolchain"];
  uploader: EspUploadCommandContext;
  trustedImageRoots?: readonly string[];
}

/**
 * Consume a private capture record without trusting it to choose the workspace or package roots.
 * The command is checked against host-selected tool and device identities. Manifest-bound authorization
 * and immediate artifact revalidation are still required before execution. This function never starts an uploader.
 */
export async function retainUploadCapture(
  recordPath: string,
  context: UploadCaptureContext,
  archiveRoot?: string,
) {
  const selected = {
    ...context,
    toolchain: { ...context.toolchain },
    uploader: { ...context.uploader },
    trustedImageRoots: [...(context.trustedImageRoots ?? [])],
  };
  const root = await fs.realpath(selected.captureDirectory);
  const project = await fs.realpath(selected.projectDir);
  const artifact = await readPartitionArtifact(
    root,
    recordPath,
    2 * 1024 * 1024,
  );
  let record: z.infer<typeof RecordSchema>;
  try {
    record = RecordSchema.parse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(artifact.content),
      ),
    );
  } catch {
    throw new PlatformIOError(
      "Invalid final upload capture record.",
      "UPLOAD_CAPTURE_INVALID",
    );
  }
  if (
    (await fs.realpath(record.projectDir)) !== project ||
    record.environment !== selected.environment ||
    record.compiler !== selected.compiler
  )
    throw new PlatformIOError(
      "Upload capture differs from the selected build context.",
      "UPLOAD_CAPTURE_CONTEXT_CHANGED",
    );
  if (
    record.elf.size > 256 * 1024 * 1024 ||
    record.images.some((image) => image.size > 64 * 1024 * 1024) ||
    record.images.reduce((sum, image) => sum + image.size, 0) >
      128 * 1024 * 1024
  )
    throw new PlatformIOError(
      "Upload capture exceeds artifact limits.",
      "UPLOAD_CAPTURE_INVALID",
    );
  await validateEspUploadCommand(record.argv, selected.uploader);
  return captureEspUploadManifest(
    {
      projectDir: project,
      environment: selected.environment,
      toolchain: selected.toolchain,
      buildSettingsSha256: record.buildSettingsSha256,
      elf: { path: record.elf.path, sha256: record.elf.sha256 },
      images: record.images.map(({ size: _size, ...image }) => image),
    },
    record.argv,
    archiveRoot,
    selected.trustedImageRoots,
  );
}
