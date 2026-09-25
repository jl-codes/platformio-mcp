/** Host-only selection of optional core-dump tools; request payloads never grant executable trust. */
import fs from "node:fs/promises";
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";
import {
  discoverDebuggerRoots,
  resolveDebuggerExecutable,
} from "../debug/debug-discovery.js";

/** Resolve explicitly configured tools without PATH lookup, package installation or project execution. */
export async function resolveEspCoredumpTools(
  projectDir: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const python = environment.PIO_MCP_COREDUMP_PYTHON;
  const debuggerPath = environment.PIO_MCP_COREDUMP_GDB;
  if (!python || !debuggerPath)
    throw new PlatformIOError(
      "Configure PIO_MCP_COREDUMP_PYTHON and PIO_MCP_COREDUMP_GDB in the server environment; install the optional coredump dependencies explicitly.",
      "COREDUMP_TOOLS_UNCONFIGURED",
    );
  if (
    [python, debuggerPath].some(
      (value) =>
        !path.isAbsolute(value) ||
        value.length > 32768 ||
        /[\x00-\x1f\x7f]/.test(value),
    ) ||
    /\.(?:cmd|bat|ps1|sh)$/i.test(python)
  )
    throw new PlatformIOError(
      "Core-dump tools require absolute native executable paths.",
      "COREDUMP_TOOLS_INVALID",
    );
  const project = await fs.realpath(projectDir);
  const executable = await fs.realpath(python);
  const relative = path.relative(project, executable);
  if (
    !relative ||
    (relative !== ".." &&
      !relative.startsWith(".." + path.sep) &&
      !path.isAbsolute(relative)) ||
    !(await fs.stat(executable)).isFile()
  )
    throw new PlatformIOError(
      "The configured Python interpreter must be installed outside the workspace.",
      "COREDUMP_TOOLS_INVALID",
    );
  const roots = await discoverDebuggerRoots(
    debuggerPath,
    null,
    project,
    environment,
  );
  const debuggerExecutable = await resolveDebuggerExecutable(
    debuggerPath,
    roots,
    project,
  );
  return {
    pythonExecutable: executable,
    debuggerExecutable,
    trustedDebuggerRoots: roots,
  };
}
