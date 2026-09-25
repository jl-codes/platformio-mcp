/** Select dependency audit inputs from Core-resolved configuration without reading or executing the selected paths. */
import path from "node:path";
import { parseProjectEnvironments } from "./project-inspection.js";
import { parseDependencyDeclaration } from "./dependency-manifest.js";
import type { DependencyInventoryRoot } from "./dependency-inventory.js";
import { PlatformIOError } from "../utils/errors.js";

/** Normalize resolved list options without splitting commas inside package URLs or directory names. */
function list(value: unknown): string[] {
  if (value == null || value === "") return [];
  const values = typeof value === "string" ? value.split(/\r?\n/) : value;
  if (
    !Array.isArray(values) ||
    values.length > 2048 ||
    values.some(
      (item) =>
        typeof item !== "string" ||
        item.length > 4096 ||
        /[\x00-\x1f\x7f]/.test(item),
    )
  )
    throw new PlatformIOError(
      "Invalid resolved dependency configuration.",
      "DEPENDENCY_CONFIG_INVALID",
    );
  return values.map((item) => (item as string).trim()).filter(Boolean);
}
/** Resolve the requested environment or first configured default; all returned roots still require authorization. */
export function dependencyProjectInputs(
  projectDir: string,
  report: ReturnType<typeof parseProjectEnvironments>,
  environment?: string,
) {
  const selected = environment ?? report.defaultEnvironments[0];
  const env = report.envs.find((item) => item.name === selected);
  if (!env || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,49}$/.test(env.name))
    throw new PlatformIOError(
      "No valid selected environment for dependency inspection.",
      "DEPENDENCY_ENVIRONMENT_INVALID",
    );
  const project = path.resolve(projectDir);
  const settingPath = (value: unknown, fallback: string) => {
    if (value == null) return path.join(project, fallback);
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 32768 ||
      /[\x00-\x1f\x7f]/.test(value)
    )
      throw new PlatformIOError(
        "Invalid resolved library directory.",
        "DEPENDENCY_CONFIG_INVALID",
      );
    return path.resolve(project, value);
  };
  const extras = list(env.libraryExtraDirectories);
  if (extras.length > 62)
    throw new PlatformIOError(
      "Too many library search directories.",
      "DEPENDENCY_LIMIT",
    );
  const roots: DependencyInventoryRoot[] = [
    {
      directory: settingPath(report.platformioSection.lib_dir, "lib"),
      source: "lib",
    },
    ...extras.map((directory) => ({
      directory: path.resolve(project, directory),
      source: "extra" as const,
    })),
    {
      directory: path.join(
        settingPath(report.platformioSection.libdeps_dir, ".pio/libdeps"),
        env.name,
      ),
      source: "libdeps",
    },
  ];
  return {
    projectDir: project,
    environment: env.name,
    declared: list(env.libraryDependencies).map(parseDependencyDeclaration),
    roots,
    ldfMode: env.libraryDependencyFinderMode,
    compatibilityMode: env.libraryCompatibilityMode,
  };
}
