/** Resolve an explicitly configured PPK2 environment without PATH lookup, installation or interpreter execution. */
import fs from "node:fs/promises";
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";

function contains(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return (
    !relative ||
    (relative !== ".." &&
      !relative.startsWith(".." + path.sep) &&
      !path.isAbsolute(relative))
  );
}

/** Host environment configuration establishes trust; setup metadata is evidence, never an executable-selection capability. */
export async function resolvePpk2Environment(
  projectDir: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configured = environment.PIO_MCP_PPK2_ENV;
  if (!configured)
    throw new PlatformIOError(
      "Install the optional PPK2 environment explicitly and set PIO_MCP_PPK2_ENV on the server.",
      "PPK2_ENV_UNCONFIGURED",
    );
  if (
    !path.isAbsolute(configured) ||
    configured.length > 32768 ||
    /[\x00-\x1f\x7f]/.test(configured)
  )
    throw new PlatformIOError(
      "PPK2 environment must be an absolute host path.",
      "PPK2_ENV_INVALID",
    );
  try {
    const project = await fs.realpath(projectDir),
      root = await fs.realpath(configured);
    if (
      contains(project, root) ||
      contains(root, project) ||
      !(await fs.stat(root)).isDirectory()
    )
      throw new Error("Project and environment must be disjoint.");
    const config = path.join(root, "pyvenv.cfg");
    const configStat = await fs.stat(config);
    if (
      !configStat.isFile() ||
      configStat.size > 16384 ||
      !contains(root, await fs.realpath(config))
    )
      throw new Error("Invalid virtual environment configuration.");
    const settings = await fs.readFile(config, "utf8");
    if (!/^include-system-site-packages\s*=\s*false\s*$/im.test(settings))
      throw new Error("System site packages must be disabled.");
    const directory = path.join(
      root,
      process.platform === "win32" ? "Scripts" : "bin",
    );
    if (!contains(root, await fs.realpath(directory)))
      throw new Error("Interpreter directory escapes environment.");
    const pythonExecutable = path.join(
      directory,
      process.platform === "win32" ? "python.exe" : "python",
    );
    const native = await fs.realpath(pythonExecutable);
    if (
      contains(project, native) ||
      !(await fs.stat(native)).isFile() ||
      /\.(?:cmd|bat|ps1|sh)$/i.test(native)
    )
      throw new Error("Invalid native interpreter.");
    // Keep the venv pathname: resolving its POSIX symlink to the base interpreter would discard venv isolation.
    return { environmentRoot: root, pythonExecutable };
  } catch {
    throw new PlatformIOError(
      "PPK2 requires an isolated host virtual environment outside the project, with system site packages disabled.",
      "PPK2_ENV_INVALID",
    );
  }
}
