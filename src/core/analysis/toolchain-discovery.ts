/** Host-owned GNU toolchain discovery; no public tool argument can enlarge trusted roots. */
import fs from "node:fs/promises";
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";

/** Tests component containment, including the directory itself. */
function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

/** Reads bounded installation metadata without invoking package code. */
async function packageDocument(file: string): Promise<Record<string, unknown>> {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 65536)
    throw new Error("Invalid package record");
  const value: unknown = JSON.parse(await fs.readFile(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid package record");
  return value as Record<string, unknown>;
}

/**
 * Discovers a selected registered package under the host Core directory, or explicit launch roots.
 * systemInfo must originate from the host's PlatformIO system-info command, never tool arguments.
 * PIO_MCP_TOOLCHAIN_ROOTS is a JSON array in the operator launch environment for custom/native tools.
 */
export async function discoverAnalysisToolchainRoots(
  compilerPath: string,
  systemInfo: unknown,
  projectDir: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const fail = (message: string): never => {
    throw new PlatformIOError(message, "ANALYSIS_TOOLCHAIN_UNTRUSTED");
  };
  const project = await fs.realpath(projectDir);
  const validateRoot = async (root: unknown): Promise<string> => {
    if (typeof root !== "string" || !path.isAbsolute(root))
      return fail(
        "Toolchain roots must be absolute operator installation paths.",
      );
    const real = await fs.realpath(root);
    if (
      real === path.parse(real).root ||
      inside(project, real) ||
      inside(real, project) ||
      !(await fs.stat(real)).isDirectory()
    )
      return fail(
        "Toolchain installation roots cannot be filesystem roots or project-owned directories.",
      );
    return real;
  };
  if (environment.PIO_MCP_TOOLCHAIN_ROOTS !== undefined) {
    const configured = environment.PIO_MCP_TOOLCHAIN_ROOTS;
    if (Buffer.byteLength(configured) > 65536)
      return fail("Configured toolchain roots exceed 64 KiB.");
    let roots: unknown;
    try {
      roots = JSON.parse(configured);
    } catch {
      return fail(
        "PIO_MCP_TOOLCHAIN_ROOTS must be a JSON array of absolute installation paths.",
      );
    }
    if (!Array.isArray(roots) || !roots.length || roots.length > 32)
      return fail("Configure between 1 and 32 toolchain roots.");
    return [...new Set(await Promise.all(roots.map(validateRoot)))];
  }
  const value = (systemInfo as { core_dir?: { value?: unknown } } | null)
    ?.core_dir?.value;
  if (typeof value !== "string" || !path.isAbsolute(value))
    return fail(
      "PlatformIO system info did not identify an absolute Core directory.",
    );
  const packages = await validateRoot(path.join(value, "packages"));
  const compiler = await fs.realpath(compilerPath);
  if (!inside(packages, compiler))
    return fail(
      "Compiler is outside registered host packages; configure an explicit operator root for custom tools.",
    );
  const relative = path.relative(packages, compiler);
  const folder = relative.split(path.sep)[0];
  const root = await validateRoot(path.join(packages, folder));
  if (!inside(packages, root) || !inside(root, compiler))
    return fail("Toolchain package escapes the host installation.");
  try {
    const [manifest, record] = await Promise.all([
      packageDocument(path.join(root, "package.json")),
      packageDocument(path.join(root, ".piopm")),
    ]);
    if (
      typeof manifest.name !== "string" ||
      !manifest.name.startsWith("toolchain-") ||
      record.type !== "tool" ||
      record.name !== manifest.name ||
      typeof manifest.version !== "string" ||
      record.version !== manifest.version
    )
      throw new Error("Unregistered compiler package");
  } catch {
    return fail(
      "Selected compiler has no matching registered toolchain package; configure an explicit operator root if intended.",
    );
  }
  return [root];
}
