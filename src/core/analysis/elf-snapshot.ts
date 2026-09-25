/** Stable ELF snapshots prevent rebuilds from changing an in-progress analysis. */
import fs from "node:fs/promises";
import { retainElfSnapshot } from "./elf-archive.js";
import os from "node:os";
import path from "node:path";
import { readElfIdentity, type ElfIdentity } from "./elf-identity.js";

/** Runs analysis on a private hash-verified copy and removes it on every exit path. */
export async function withElfSnapshot<T>(
  elfPath: string,
  expectedSha256: string | undefined,
  analyze: (snapshot: string, identity: ElfIdentity) => Promise<T>,
  sourcePath = elfPath,
): Promise<T> {
  const identity = await readElfIdentity(elfPath, expectedSha256);
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "pio-elf-analysis-"),
  );
  try {
    await fs.chmod(directory, 0o700);
    const snapshot = path.join(directory, "firmware.elf");
    await fs.copyFile(identity.path, snapshot);
    await readElfIdentity(snapshot, identity.sha256);
    const archivePath = await retainElfSnapshot(
      snapshot,
      identity.sha256,
      undefined,
      sourcePath,
    );
    return await analyze(snapshot, { ...identity, archivePath });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
