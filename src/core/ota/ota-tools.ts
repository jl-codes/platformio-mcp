/** Resolve the host's native Python and registered Arduino framework uploader without PATH or workspace trust. */
import fs from "node:fs/promises";
import path from "node:path";
import { readPartitionArtifact } from "../esp-partition-artifacts.js";
import { PlatformIOError } from "../../utils/errors.js";
function within(root: string, target: string) {
  const relative = path.relative(root, target);
  return (
    !relative ||
    (relative !== ".." &&
      !relative.startsWith(".." + path.sep) &&
      !path.isAbsolute(relative))
  );
}
/** Inputs are authorized host system metadata and server environment, never client-provided executable paths. */
export async function resolveOtaTools(
  projectDir: string,
  family: "espressif32" | "espressif8266",
  systemInfo: unknown,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const fields = systemInfo as Record<string, { value?: unknown }> | null;
  const python = environment.PIO_MCP_OTA_PYTHON ?? fields?.python_exe?.value;
  const core = fields?.core_dir?.value;
  const packagesInput =
    environment.PLATFORMIO_PACKAGES_DIR ??
    (typeof core === "string" && path.isAbsolute(core)
      ? path.join(core, "packages")
      : undefined);
  if (
    typeof python !== "string" ||
    !path.isAbsolute(python) ||
    /[\x00-\x1f\x7f]/.test(python) ||
    /\.(?:cmd|bat|ps1|sh)$/i.test(python) ||
    !packagesInput ||
    !path.isAbsolute(packagesInput)
  )
    throw new PlatformIOError(
      "Host Python or registered PlatformIO packages are unavailable; configure PIO_MCP_OTA_PYTHON if needed.",
      "OTA_TOOLS_UNAVAILABLE",
    );
  const project = await fs.realpath(projectDir),
    executable = await fs.realpath(python),
    packages = await fs.realpath(packagesInput);
  if (
    within(project, executable) ||
    within(project, packages) ||
    within(packages, project) ||
    !(await fs.stat(executable)).isFile()
  )
    throw new PlatformIOError(
      "OTA tools must be installed outside the workspace.",
      "OTA_TOOLS_UNTRUSTED",
    );
  if (!["espressif32", "espressif8266"].includes(family))
    throw new PlatformIOError(
      "Unsupported OTA framework family.",
      "OTA_FAMILY_UNSUPPORTED",
    );
  const packageName = "framework-arduino" + family;
  const root = await fs.realpath(path.join(packages, packageName));
  if (
    !within(packages, root) ||
    path.relative(packages, root).split(path.sep).length !== 1
  )
    throw new PlatformIOError(
      "OTA framework is outside registered host packages.",
      "OTA_TOOLS_UNTRUSTED",
    );
  const manifest = await readPartitionArtifact(root, "package.json", 65536);
  const registration = await readPartitionArtifact(root, ".piopm", 65536);
  let declared: Record<string, unknown>, registered: Record<string, unknown>;
  try {
    declared = JSON.parse(manifest.content.toString("utf8"));
    registered = JSON.parse(registration.content.toString("utf8"));
  } catch {
    throw new PlatformIOError(
      "Invalid OTA framework registration.",
      "OTA_TOOLS_UNTRUSTED",
    );
  }
  if (
    !declared ||
    !registered ||
    declared.name !== packageName ||
    typeof declared.version !== "string" ||
    !declared.version ||
    registered.name !== declared.name ||
    registered.version !== declared.version ||
    registered.type !== "tool"
  )
    throw new PlatformIOError(
      "OTA framework registration does not match its manifest.",
      "OTA_TOOLS_UNTRUSTED",
    );
  const script = await readPartitionArtifact(
    root,
    "tools/espota.py",
    1024 * 1024,
  );
  return Object.freeze({
    pythonExecutable: executable,
    uploaderScript: script.identity.path,
    uploaderSha256: script.identity.sha256,
    packageName,
    packageVersion: declared.version,
  });
}
