/** Explicit, bounded sensitive dump export using private same-volume staging and no replacement. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PlatformIOError } from "../../utils/errors.js";
import { withPrivateAnalysisDirectory } from "./private-analysis-directory.js";

/** Write only after the caller authorizes this exact destination; the user owns exported-file retention. */
export async function exportEspCoredump(
  workspaceDir: string,
  destination: string,
  input: Uint8Array,
) {
  if (
    !destination ||
    /[\x00-\x1f\x7f]/.test(destination) ||
    input.byteLength > 16 * 1024 * 1024
  )
    throw new PlatformIOError(
      "Invalid dump export path or size.",
      "COREDUMP_EXPORT_INVALID",
    );
  const root = await fs.realpath(workspaceDir);
  const target = path.resolve(root, destination);
  const parent = await fs.realpath(path.dirname(target));
  const relative = path.relative(root, parent);
  if (
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  )
    throw new PlatformIOError(
      "Dump exports must remain in the authorized workspace.",
      "COREDUMP_EXPORT_OUTSIDE_WORKSPACE",
    );
  const name = path.basename(target);
  if (name === "." || name === ".." || name.includes(":"))
    throw new PlatformIOError(
      "Invalid dump export filename.",
      "COREDUMP_EXPORT_INVALID",
    );
  const canonicalTarget = path.join(parent, name);
  const bytes = Buffer.from(input);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return withPrivateAnalysisDirectory(async (directory) => {
    const staged = path.join(directory, "dump.bin");
    await fs.writeFile(staged, bytes, { flag: "wx", mode: 0o600 });
    if ((await fs.realpath(path.dirname(target))) !== parent)
      throw new PlatformIOError(
        "Dump export parent changed.",
        "COREDUMP_EXPORT_CHANGED",
      );
    try {
      // Linking publishes the private inode atomically and refuses any existing destination.
      await fs.link(staged, canonicalTarget);
    } catch (error) {
      throw new PlatformIOError(
        (error as NodeJS.ErrnoException).code === "EEXIST"
          ? "Dump export destination already exists."
          : "Cannot publish the private dump export.",
        (error as NodeJS.ErrnoException).code === "EEXIST"
          ? "COREDUMP_EXPORT_EXISTS"
          : "COREDUMP_EXPORT_FAILED",
      );
    }
    return {
      path: canonicalTarget,
      size: bytes.length,
      sha256,
      retention: "user_managed" as const,
    };
  }, parent);
}
