/** Private snapshots bind OTA approval to exact firmware/filesystem bytes rather than mutable build outputs. */
import fs from "node:fs/promises";
import path from "node:path";
import { createPrivateAnalysisDirectory } from "../analysis/private-analysis-directory.js";
import { readPartitionArtifact } from "../esp-partition-artifacts.js";
import { PlatformIOError } from "../../utils/errors.js";

/** Snapshot a bounded regular workspace image; keep it until the uploader's cleanup is confirmed. */
export async function retainOtaImage(
  projectDir: string,
  imagePath: string,
  expectedSha256?: string,
) {
  if (expectedSha256 !== undefined && !/^[a-fA-F0-9]{64}$/.test(expectedSha256))
    throw new PlatformIOError(
      "Invalid expected OTA image hash.",
      "OTA_IMAGE_INVALID",
    );
  const project = await fs.realpath(projectDir);
  const source = await readPartitionArtifact(
    project,
    imagePath,
    64 * 1024 * 1024,
  );
  if (!source.identity.size)
    throw new PlatformIOError("OTA image is empty.", "OTA_IMAGE_INVALID");
  if (expectedSha256 && source.identity.sha256 !== expectedSha256.toLowerCase())
    throw new PlatformIOError(
      "OTA image changed before capture.",
      "OTA_IMAGE_CHANGED",
    );
  const directory = await fs.realpath(await createPrivateAnalysisDirectory());
  try {
    const snapshot = path.join(directory, "image.bin");
    await fs.writeFile(snapshot, source.content, { flag: "wx", mode: 0o600 });
    const identity = Object.freeze({
      ...source.identity,
      path: snapshot,
      sourcePath: source.identity.path,
    });
    let releasing: Promise<void> | undefined;
    return Object.freeze({
      path: snapshot,
      identity,
      async verify() {
        const artifact = await readPartitionArtifact(
          directory,
          snapshot,
          64 * 1024 * 1024,
        );
        if (
          artifact.identity.sha256 !== identity.sha256 ||
          artifact.identity.size !== identity.size
        )
          throw new PlatformIOError(
            "Retained OTA image changed.",
            "OTA_IMAGE_CHANGED",
          );
      },
      release() {
        releasing ??= fs
          .rm(directory, { recursive: true, force: true })
          .catch((error: unknown) => {
            releasing = undefined;
            throw error;
          });
        return releasing;
      },
    });
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}
