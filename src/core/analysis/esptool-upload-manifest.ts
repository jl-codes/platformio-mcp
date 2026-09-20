/** Bind final esptool argv operands to an exact retained image/ELF manifest. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PlatformIOError } from "../../utils/errors.js";
import {
  captureUploadManifest,
  type UploadManifestInput,
} from "./upload-manifest.js";
import {
  parseEspUploadImageOperands,
  substituteEspUploadImages,
} from "./esptool-upload-inputs.js";

/**
 * Capture only when every declared image agrees with final argv. The trusted launcher must separately
 * validate executable/port/options, authorize the returned manifest hash and reverify before spawning.
 */
export async function captureEspUploadManifest(
  input: UploadManifestInput,
  expandedArgv: readonly string[],
  archiveRoot?: string,
) {
  const argv = [...expandedArgv];
  const operands = parseEspUploadImageOperands(argv);
  const selected = {
    ...input,
    elf: { ...input.elf },
    toolchain: { ...input.toolchain },
    images: input.images.map((image) => ({ ...image })),
  };
  if (operands.length !== selected.images.length)
    throw new PlatformIOError(
      "Final uploader image set differs from its manifest.",
      "UPLOAD_MANIFEST_INVALID",
    );
  // Relative operands are resolved in the selected project, as they are by the actual upload process.
  const project = await fs.realpath(selected.projectDir);
  for (const operand of operands) {
    const declaration = selected.images.find(
      (image) => image.offset === operand.offset,
    );
    if (
      !declaration ||
      (await fs.realpath(path.resolve(project, declaration.path))) !==
        (await fs.realpath(path.resolve(project, operand.path)))
    )
      throw new PlatformIOError(
        "Final uploader image differs from its declared input.",
        "UPLOAD_MANIFEST_INVALID",
      );
  }
  const commandSha256 = createHash("sha256")
    .update(JSON.stringify(argv))
    .digest("hex");
  if (
    selected.uploadCommandSha256 &&
    selected.uploadCommandSha256 !== commandSha256
  )
    throw new PlatformIOError(
      "Final upload command changed.",
      "UPLOAD_ARTIFACT_CHANGED",
    );
  const retained = await captureUploadManifest(
    { ...selected, uploadCommandSha256: commandSha256 },
    archiveRoot,
  );
  const manifest = retained.manifest;
  const rewritten = substituteEspUploadImages(
    argv,
    operands.map((operand) => {
      const image = manifest.images.find(
        (image) => image.offset === operand.offset,
      )!;
      return {
        argumentIndex: operand.argumentIndex,
        originalPath: operand.path,
        retainedPath: image.archivePath,
      };
    }),
  );
  return {
    get manifest() {
      return retained.manifest;
    },
    sha256: retained.sha256,
    path: retained.path,
    verify: retained.verify,
    get arguments() {
      return [...rewritten];
    },
  };
}
