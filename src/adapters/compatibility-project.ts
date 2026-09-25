/** Resolve launch-owned compatibility project defaults without granting execution permission. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PlatformIOError } from "../utils/errors.js";

/** Launch-owned defaults; public requests must not supply the environment or process directory. */
export interface CompatibilityProjectDefaults {
  projectDir?: string;
  cwd?: string;
  home?: string;
}

/** Resolve the reference's explicit path, launch default, then cwd, requiring a PlatformIO project. */
export async function resolveCompatibilityProject(
  requested: string | null | undefined,
  defaults: CompatibilityProjectDefaults,
): Promise<string> {
  let selected =
    requested || defaults.projectDir || defaults.cwd || process.cwd();
  if (
    selected === "~" ||
    selected.startsWith("~/") ||
    selected.startsWith("~\\")
  )
    selected = path.join(defaults.home ?? os.homedir(), selected.slice(2));
  else if (selected.startsWith("~"))
    throw new PlatformIOError(
      "Named-user home expansion is unsupported; pass an absolute project path.",
      "COMPAT_PROJECT_INVALID",
    );
  const canonical = await fs.realpath(
    path.resolve(defaults.cwd ?? process.cwd(), selected),
  );
  if (
    !(await fs.stat(canonical)).isDirectory() ||
    !(await fs.stat(path.join(canonical, "platformio.ini"))).isFile()
  )
    throw new PlatformIOError(
      "Expected a PlatformIO project directory.",
      "COMPAT_PROJECT_INVALID",
    );
  return canonical;
}
