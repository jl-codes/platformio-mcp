/** Resolve upload tools and image roots from the host's registered PlatformIO installation. */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PlatformIOError } from "../../utils/errors.js";
import { readPartitionArtifact } from "../esp-partition-artifacts.js";

const PackageSchema = z.object({
  name: z.string().min(1).max(256),
  version: z.string().min(1).max(128),
});
const RegistrationSchema = PackageSchema.extend({ type: z.literal("tool") });
function within(root: string, value: string): boolean {
  const relative = path.relative(root, value);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(".." + path.sep))
  );
}

/** Inspect registration without importing package code; missing or invalid packages confer no trust. */
async function registeredPackage(root: string) {
  try {
    const manifest = PackageSchema.parse(
      JSON.parse(
        (
          await readPartitionArtifact(root, "package.json", 65536)
        ).content.toString("utf8"),
      ),
    );
    const registration = RegistrationSchema.parse(
      JSON.parse(
        (await readPartitionArtifact(root, ".piopm", 65536)).content.toString(
          "utf8",
        ),
      ),
    );
    if (
      manifest.name !== registration.name ||
      manifest.version !== registration.version
    )
      return undefined;
    return { root, ...manifest };
  } catch {
    return undefined;
  }
}

/**
 * systemInfo must come from the host's authorized system-info operation, never public request fields.
 * compilerPath is the selected build metadata compiler. Returned roots cannot be extended by projects.
 * This reads registration and path identities only; it neither downloads nor executes package code.
 */
export async function discoverUploadInstallation(
  systemInfo: unknown,
  projectDir: string,
  compilerPath: string,
) {
  const invalid = () =>
    new PlatformIOError(
      "Upload tools are not a verified host PlatformIO installation.",
      "UPLOAD_INSTALLATION_INVALID",
    );
  const info = systemInfo as {
    core_dir?: { value?: unknown };
    python_exe?: { value?: unknown };
  } | null;
  const core = info?.core_dir?.value;
  const python = info?.python_exe?.value;
  if (
    typeof core !== "string" ||
    !path.isAbsolute(core) ||
    typeof python !== "string" ||
    !path.isAbsolute(python) ||
    !path.isAbsolute(compilerPath) ||
    /\.(?:cmd|bat|ps1|sh|py)$/i.test(python)
  )
    throw invalid();
  const [project, packages, pythonPath, compiler] = await Promise.all([
    fs.realpath(projectDir),
    fs.realpath(path.join(core, "packages")),
    fs.realpath(python),
    fs.realpath(compilerPath),
  ]);
  if (
    within(project, packages) ||
    within(packages, project) ||
    within(project, pythonPath) ||
    !within(packages, compiler) ||
    !(await fs.stat(pythonPath)).isFile() ||
    !(await fs.stat(compiler)).isFile()
  )
    throw invalid();
  const entries = await fs.readdir(packages, { withFileTypes: true });
  if (entries.length > 256) throw invalid();
  const registered: Array<{ root: string; name: string; version: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const root = await fs.realpath(path.join(packages, entry.name));
    if (!within(packages, root) || root === packages) continue;
    const record = await registeredPackage(root);
    if (record) registered.push(record);
  }
  const toolchain = registered.find(
    (item) => item.name.startsWith("toolchain-") && within(item.root, compiler),
  );
  const uploaders = registered.filter((item) => item.name === "tool-esptoolpy");
  if (!toolchain || uploaders.length !== 1 || registered.length > 128)
    throw invalid();
  const esptoolPath = await fs.realpath(
    path.join(uploaders[0].root, "esptool.py"),
  );
  if (
    !within(uploaders[0].root, esptoolPath) ||
    !(await fs.stat(esptoolPath)).isFile()
  )
    throw invalid();
  return {
    compilerPath: compiler,
    pythonPath,
    esptoolPath,
    toolchain: { id: toolchain.name, version: toolchain.version },
    trustedImageRoots: registered.map((item) => item.root),
  };
}
