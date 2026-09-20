/** Immutable, private ELF lifetime for persistent debugger sessions and firmware download. */
import fs from "node:fs/promises";
import path from "node:path";
import type { OwnedDebugProcess } from "./debug-client-sessions.js";
import { PlatformIOError } from "../../utils/errors.js";
import { createPrivateAnalysisDirectory } from "../analysis/private-analysis-directory.js";
import { readElfIdentity, type ElfIdentity } from "../analysis/elf-identity.js";

/** Release only after every debugger/server consumer has been confirmed stopped. */
export interface DebugElfLease {
  readonly path: string;
  readonly identity: Readonly<ElfIdentity>;
  release(): Promise<void>;
}

/** Resolve the selected workspace artifact and freeze its bytes independently of future rebuilds. */
export async function retainDebugElf(
  projectDir: string,
  elfPath: string,
  expectedSha256?: string,
): Promise<DebugElfLease> {
  const project = await fs.realpath(projectDir);
  const source = await fs.realpath(path.resolve(project, elfPath));
  const relative = path.relative(project, source);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  )
    throw new PlatformIOError(
      "Debugger ELF must belong to the authorized project.",
      "DEBUG_ELF_OUTSIDE_WORKSPACE",
    );
  const identity = await readElfIdentity(source, expectedSha256);
  const directory = await createPrivateAnalysisDirectory();
  try {
    const snapshot = path.join(directory, "firmware.elf");
    await fs.copyFile(source, snapshot, fs.constants.COPYFILE_EXCL);
    await fs.chmod(snapshot, 0o600);
    await readElfIdentity(snapshot, identity.sha256);
    let release: Promise<void> | undefined;
    return Object.freeze({
      path: snapshot,
      identity: Object.freeze({ ...identity }),
      release() {
        if (!release) {
          release = fs
            .rm(directory, { recursive: true, force: true })
            .catch((error: unknown) => {
              release = undefined;
              throw error;
            });
        }
        return release;
      },
    });
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Couple artifact release to confirmed process/probe cleanup; failed cleanup retains the ELF. */
export function ownDebugElf(
  process: OwnedDebugProcess,
  lease: DebugElfLease,
): OwnedDebugProcess {
  return {
    command: process.command.bind(process),
    state: process.state.bind(process),
    async cleanupProcess() {
      await process.cleanupProcess();
      await lease.release();
    },
  };
}
