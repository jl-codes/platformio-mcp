/** Retain content-addressed ELF copies so later builds cannot discard report artifacts. */
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SERVER_DATA_DIR } from "../../utils/paths.js";
import { PlatformIOError } from "../../utils/errors.js";
import { readElfIdentity } from "./elf-identity.js";

/**
 * Atomically publish one validated copy, or verify an existing object without overwriting it.
 * The optional archive root is a trusted integration dependency, never a public tool argument.
 */
export async function retainElfSnapshot(
  snapshot: string,
  expectedSha256: string,
  archiveRoot = path.join(SERVER_DATA_DIR, "artifacts", "elf"),
): Promise<string> {
  const identity = await readElfIdentity(snapshot, expectedSha256);
  await fs.mkdir(archiveRoot, { recursive: true, mode: 0o700 });
  const rootState = await fs.lstat(archiveRoot);
  if (!rootState.isDirectory() || rootState.isSymbolicLink())
    throw new PlatformIOError(
      "ELF archive must be an owned directory.",
      "ANALYSIS_ARCHIVE_INVALID",
    );
  const root = await fs.realpath(archiveRoot);
  const destination = path.join(root, identity.sha256 + ".elf");
  const temporary = path.join(root, "." + randomUUID() + ".tmp");
  try {
    await fs.copyFile(identity.path, temporary, constants.COPYFILE_EXCL);
    await fs.chmod(temporary, 0o600);
    await readElfIdentity(temporary, identity.sha256);
    try {
      // Same-directory hard linking publishes a complete file without replacing an existing hash.
      await fs.link(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stored = await fs.lstat(destination);
    if (!stored.isFile() || stored.isSymbolicLink())
      throw new PlatformIOError(
        "Invalid retained ELF object.",
        "ANALYSIS_ARCHIVE_INVALID",
      );
    await readElfIdentity(destination, identity.sha256);
    return destination;
  } finally {
    await fs.unlink(temporary).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}
