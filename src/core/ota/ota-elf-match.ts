/** Match an explicitly selected ELF to retained OTA image metadata and preserve its exact bytes. */
import fs from "node:fs/promises";
import path from "node:path";
import { readPartitionArtifact } from "../esp-partition-artifacts.js";
import { createPrivateAnalysisDirectory } from "../analysis/private-analysis-directory.js";
import { readElfIdentity } from "../analysis/elf-identity.js";
import { retainElfSnapshot } from "../analysis/elf-archive.js";
import { PlatformIOError } from "../../utils/errors.js";

/** Host invokes only inside the scoped image/ELF read grant; archiveRoot is a trusted test dependency. */
export async function matchAndRetainOtaElf(
  projectDir: string,
  elfPath: string,
  embeddedSha256: string | null,
  archiveRoot?: string,
) {
  if (!embeddedSha256 || !/^[a-f0-9]{64}$/.test(embeddedSha256))
    throw new PlatformIOError(
      "Selected image has no supported embedded ELF identity.",
      "OTA_ELF_IDENTITY_UNAVAILABLE",
    );
  const project = await fs.realpath(projectDir);
  const source = await readPartitionArtifact(
    project,
    elfPath,
    256 * 1024 * 1024,
  );
  if (source.identity.sha256 !== embeddedSha256)
    throw new PlatformIOError(
      "Selected ELF does not match the OTA image's embedded identity.",
      "OTA_ELF_MISMATCH",
    );
  const directory = await createPrivateAnalysisDirectory();
  try {
    const snapshot = path.join(directory, "firmware.elf");
    await fs.writeFile(snapshot, source.content, { flag: "wx", mode: 0o600 });
    const identity = await readElfIdentity(snapshot, embeddedSha256);
    if (
      identity.bits !== 32 ||
      !["xtensa", "riscv"].includes(identity.architecture)
    )
      throw new PlatformIOError(
        "Selected ELF is not an ESP32 target image.",
        "OTA_ELF_TARGET_INVALID",
      );
    const archivePath = await retainElfSnapshot(
      snapshot,
      embeddedSha256,
      archiveRoot,
      source.identity.path,
    );
    return { ...identity, path: source.identity.path, archivePath };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
