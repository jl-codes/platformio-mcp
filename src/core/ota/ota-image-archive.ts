/** Persist exact OTA image bytes without replacing an existing content-addressed object. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { SERVER_DATA_DIR } from "../../utils/paths.js";
import { PlatformIOError } from "../../utils/errors.js";
import { readPartitionArtifact } from "../esp-partition-artifacts.js";

/** Archive only a validated private snapshot; source scopes histories, never selects uploaded bytes. */
export async function archiveOtaImage(
  snapshot: string,
  sourcePath: string,
  expectedSha256: string,
  archiveRoot = path.join(SERVER_DATA_DIR, "artifacts", "ota"),
): Promise<string> {
  const image = await readPartitionArtifact(
    path.dirname(snapshot),
    snapshot,
    64 * 1024 * 1024,
  );
  if (image.identity.sha256 !== expectedSha256)
    throw new PlatformIOError(
      "OTA snapshot changed before archival.",
      "OTA_IMAGE_CHANGED",
    );
  const scope = createHash("sha256").update(sourcePath).digest("hex");
  const directory = path.join(archiveRoot, scope);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const state = await fs.lstat(directory);
  if (!state.isDirectory() || state.isSymbolicLink())
    throw new PlatformIOError(
      "Invalid OTA archive directory.",
      "OTA_ARCHIVE_INVALID",
    );
  const root = await fs.realpath(directory);
  const destination = path.join(root, expectedSha256 + ".bin");
  const temporary = path.join(root, "." + randomUUID() + ".tmp");
  try {
    await fs.writeFile(temporary, image.content, { flag: "wx", mode: 0o600 });
    try {
      await fs.link(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stored = await fs.lstat(destination);
    if (!stored.isFile() || stored.isSymbolicLink())
      throw new PlatformIOError(
        "Invalid OTA archive object.",
        "OTA_ARCHIVE_INVALID",
      );
    const verified = await readPartitionArtifact(
      root,
      destination,
      64 * 1024 * 1024,
    );
    if (verified.identity.sha256 !== expectedSha256)
      throw new PlatformIOError(
        "Existing OTA archive object has changed.",
        "OTA_ARCHIVE_INVALID",
      );
    return destination;
  } finally {
    await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
