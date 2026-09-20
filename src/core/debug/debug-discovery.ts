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

/**
 * Find the exact registered GDB package under the host-reported Core installation.
 * A custom/native installation requires PIO_MCP_DEBUGGER_ROOTS in the server environment.
 * systemInfo must come from the host's authorized system-info call, never client arguments.
 */
export async function discoverDebuggerRoots(
  debuggerPath: string,
  systemInfo: unknown,
  projectDir: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const invalid = (message: string): never => {
    throw new PlatformIOError(message, "GDB_EXECUTABLE_UNTRUSTED");
  };
  const configured = environment.PIO_MCP_DEBUGGER_ROOTS;
  if (configured !== undefined) {
    let roots: unknown;
    if (Buffer.byteLength(configured) > 65536)
      return invalid("Debugger root configuration exceeds 64 KiB.");
    try {
      roots = JSON.parse(configured);
    } catch {
      return invalid("PIO_MCP_DEBUGGER_ROOTS must be a JSON array.");
    }
    if (
      !Array.isArray(roots) ||
      roots.length < 1 ||
      roots.length > 32 ||
      roots.some((root) => typeof root !== "string" || !path.isAbsolute(root))
    )
      return invalid(
        "Configure between 1 and 32 absolute debugger installation roots.",
      );
    await resolveDebuggerExecutable(debuggerPath, roots, projectDir);
    return [
      ...new Set(
        await Promise.all(roots.map((root: string) => fs.realpath(root))),
      ),
    ];
  }
  const core = (systemInfo as { core_dir?: { value?: unknown } } | null)
    ?.core_dir?.value;
  if (typeof core !== "string" || !path.isAbsolute(core))
    return invalid(
      "PlatformIO system info did not identify an absolute Core directory.",
    );
  const packages = await fs.realpath(path.join(core, "packages"));
  const executable = await fs.realpath(debuggerPath);
  if (!within(packages, executable))
    return invalid(
      "Debugger is outside registered host packages; configure an operator root.",
    );
  const folder = path.relative(packages, executable).split(path.sep)[0];
  const root = await fs.realpath(path.join(packages, folder));
  if (!within(packages, root))
    return invalid("Debugger package escapes the Core installation.");
  const readRecord = async (file: string): Promise<Record<string, unknown>> => {
    const handle = await fs.open(file, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 65536)
        return invalid("Invalid debugger package record.");
      const bytes = Buffer.alloc(65537);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 65536)
        return invalid("Debugger package record exceeds 64 KiB.");
      const value: unknown = JSON.parse(
        bytes.subarray(0, bytesRead).toString("utf8"),
      );
      if (!value || typeof value !== "object" || Array.isArray(value))
        return invalid("Invalid debugger package record.");
      return value as Record<string, unknown>;
    } finally {
      await handle.close();
    }
  };
  try {
    const [manifest, record] = await Promise.all([
      readRecord(path.join(root, "package.json")),
      readRecord(path.join(root, ".piopm")),
    ]);
    if (
      typeof manifest.name !== "string" ||
      !(
        manifest.name.startsWith("toolchain-") ||
        /^tool-.*gdb(?:-|$)/.test(manifest.name)
      ) ||
      typeof manifest.version !== "string" ||
      !manifest.version ||
      record.type !== "tool" ||
      record.name !== manifest.name ||
      record.version !== manifest.version
    )
      return invalid(
        "Debugger package registration does not match its manifest.",
      );
  } catch (error) {
    if (error instanceof PlatformIOError) throw error;
    return invalid("Debugger package registration is missing or invalid.");
  }
  await resolveDebuggerExecutable(executable, [root], projectDir);
  return [root];
}
