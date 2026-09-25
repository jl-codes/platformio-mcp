/** Bind validated offline core dumps to stable, workspace-authorized ELF snapshots. */
import fs from "node:fs/promises";
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";
import {
  readEspCoredumpArtifact,
  inspectCapturedEspCoredump,
  type EspCoredumpArtifactInput,
} from "./esp-coredump-artifact.js";
import { matchEspCoredumpFirmware } from "./esp-coredump-firmware.js";
import { readElfIdentity, type ElfIdentity } from "./elf-identity.js";
import { withElfSnapshot } from "./elf-snapshot.js";

/** Explicit ELF selection and a permission revalidation hook supplied by the authorized dispatcher. */
export interface EspCoredumpAnalysisInput extends EspCoredumpArtifactInput {
  elfPath: string;
  expectedElfSha256?: string;
  validatePolicy: () => void;
}

/** Stable analysis inputs; dump bytes remain in memory until the analyzer explicitly stages them. */
export interface EspCoredumpAnalysisArtifacts {
  dump:
    | Awaited<ReturnType<typeof readEspCoredumpArtifact>>
    | ReturnType<typeof inspectCapturedEspCoredump>;
  elfPath: string;
  elfIdentity: ElfIdentity;
  correspondence: ReturnType<typeof matchEspCoredumpFirmware>;
}

/** Validate target and identity before analysis; rebuilds cannot silently replace the selected ELF. */
export async function withEspCoredumpArtifacts<T>(
  input: EspCoredumpAnalysisInput,
  analyze: (artifacts: EspCoredumpAnalysisArtifacts) => Promise<T>,
  capturedBytes?: Uint8Array, // Internal acquisition result; never accepted by public request schemas.
): Promise<T> {
  input.validatePolicy();
  const root = await fs.realpath(input.workspaceDir);
  const elf = await fs.realpath(path.resolve(root, input.elfPath));
  const relative = path.relative(root, elf);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  )
    throw new PlatformIOError(
      "Selected ELF is outside the authorized workspace.",
      "COREDUMP_ELF_OUTSIDE_WORKSPACE",
    );
  const dump =
    capturedBytes === undefined
      ? await readEspCoredumpArtifact({ ...input, workspaceDir: root })
      : inspectCapturedEspCoredump(
          capturedBytes,
          input.expectedInputSha256,
          input.encrypted,
        );
  const identity = await readElfIdentity(elf, input.expectedElfSha256);
  const machine = ["esp32", "esp32s2", "esp32s3"].includes(dump.identity.chip)
    ? 94
    : 243;
  if (
    identity.machine !== machine ||
    identity.bits !== 32 ||
    identity.byteOrder !== "little"
  )
    throw new PlatformIOError(
      "Selected ELF target does not match the core-dump chip.",
      "COREDUMP_ELF_TARGET_MISMATCH",
    );
  const correspondence = dump.firmwareIdentity
    ? matchEspCoredumpFirmware(dump.firmwareIdentity, identity.sha256)
    : { status: "unavailable" as const, hashBits: 0 };
  input.validatePolicy();
  return withElfSnapshot(
    elf,
    identity.sha256,
    async (snapshot, stableIdentity) => {
      input.validatePolicy();
      const result = await analyze({
        dump,
        elfPath: snapshot,
        elfIdentity: stableIdentity,
        correspondence,
      });
      input.validatePolicy();
      return result;
    },
  );
}
