/**
 * Select the environment's actual GDB metadata and validate a host-installed debugger.
 * Project metadata identifies candidates; only operator or registered package roots grant trust.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";
import {
  selectBuildMetadata,
  type SelectedBuildMetadata,
} from "../analysis/build-metadata.js";

/** PlatformIO debug configuration uses gdb_path, which can belong to a separate package. */
export interface SelectedDebugMetadata extends SelectedBuildMetadata {
  debuggerPath: string;
}

/** Read the selected environment's debugger without guessing a compiler-adjacent executable. */
export function selectDebugMetadata(
  output: string,
  environment?: string,
): SelectedDebugMetadata {
  const selected = selectBuildMetadata(output, environment);
  const value: unknown = JSON.parse(output)[selected.environment].gdb_path;
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    value.length > 32768 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new PlatformIOError(
      "Selected metadata has no absolute debugger path.",
      "GDB_METADATA_INVALID",
    );
  return { ...selected, debuggerPath: path.normalize(value) };
}

function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Validate an exact debugger executable against trusted host roots.
 * Paths and roots are resolved to prevent symlink escapes; project-owned roots never qualify.
 */
export async function resolveDebuggerExecutable(
  candidate: string,
  trustedRoots: readonly string[],
  projectDir: string,
): Promise<string> {
  const invalid = (message: string): never => {
    throw new PlatformIOError(message, "GDB_EXECUTABLE_UNTRUSTED");
  };
  if (
    !path.isAbsolute(candidate) ||
    !path.isAbsolute(projectDir) ||
    trustedRoots.length < 1 ||
    trustedRoots.length > 32 ||
    trustedRoots.some((root) => !path.isAbsolute(root))
  )
    return invalid("Debugger requires absolute host installation roots.");
  const [executable, project, roots] = await Promise.all([
    fs.realpath(candidate),
    fs.realpath(projectDir),
    Promise.all(trustedRoots.map((root) => fs.realpath(root))),
  ]);
  for (const root of roots) {
    if (
      root === path.parse(root).root ||
      root === project ||
      within(project, root) ||
      within(root, project) ||
      !(await fs.stat(root)).isDirectory()
    )
      return invalid(
        "Debugger installation roots cannot contain or belong to the project.",
      );
  }
  if (
    !roots.some((root) => within(root, executable)) ||
    !/^(?:[a-z0-9_]+-)*gdb(?:\.exe)?$/i.test(path.basename(executable)) ||
    !(await fs.stat(executable)).isFile()
  )
    return invalid(
      "Debugger is not a native GDB within the trusted installation.",
    );
  return executable;
}
