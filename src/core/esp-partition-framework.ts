/**
 * Resolve declared framework partition CSVs only within registered host packages.
 * Metadata selects a candidate; host Core location and matching package records bound file access.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { readPartitionArtifact } from "./esp-partition-artifacts.js";
import { PlatformIOError } from "../utils/errors.js";

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
}

/** Extract framework root candidates from the complete selected build include inventory. */
export function partitionFrameworkCandidates(
  includes: readonly string[],
): string[] {
  const candidates = new Set<string>();
  for (const include of includes) {
    const normalized = include.replace(/\\/g, "/");
    const match =
      /^(.*\/framework-(?:arduinoespressif32|espidf)(?:@[^/]+)?)(?:\/|$)/.exec(
        normalized,
      );
    if (match) candidates.add(path.normalize(match[1]));
  }
  if (candidates.size > 32)
    throw new PlatformIOError(
      "Too many framework package candidates.",
      "PARTITION_FRAMEWORK_AMBIGUOUS",
    );
  return [...candidates];
}

/** Resolve one requested CSV name; roots/systemInfo must come from authorized host metadata. */
export async function resolveFrameworkPartitionCsv(
  filename: string,
  candidates: readonly string[],
  systemInfo: unknown,
  projectDir: string,
) {
  if (
    !filename ||
    filename !== path.basename(filename) ||
    !/\.csv$/i.test(filename) ||
    filename.length > 256 ||
    /[\x00-\x1f\x7f]/.test(filename)
  )
    throw new PlatformIOError(
      "Framework lookup requires one CSV filename.",
      "PARTITION_FRAMEWORK_INVALID",
    );
  const core = (systemInfo as { core_dir?: { value?: unknown } } | null)
    ?.core_dir?.value;
  if (typeof core !== "string" || !path.isAbsolute(core))
    throw new PlatformIOError(
      "Host Core package location is unavailable.",
      "PARTITION_FRAMEWORK_UNTRUSTED",
    );
  const packages = await fs.realpath(path.join(core, "packages"));
  const project = await fs.realpath(projectDir);
  if (
    packages === project ||
    within(project, packages) ||
    within(packages, project)
  )
    throw new PlatformIOError(
      "Framework installation overlaps the project workspace.",
      "PARTITION_FRAMEWORK_UNTRUSTED",
    );
  if (candidates.length > 32)
    throw new PlatformIOError(
      "Too many framework candidates.",
      "PARTITION_FRAMEWORK_AMBIGUOUS",
    );
  const found: Array<{
    root: string;
    tablePath: string;
    packageName: string;
    packageVersion: string;
  }> = [];
  for (const candidate of new Set(candidates)) {
    const root = await fs.realpath(candidate);
    if (
      !within(packages, root) ||
      path.relative(packages, root).split(path.sep).length !== 1
    )
      throw new PlatformIOError(
        "Framework is outside registered host packages.",
        "PARTITION_FRAMEWORK_UNTRUSTED",
      );
    const manifestBytes = await readPartitionArtifact(
      root,
      "package.json",
      65536,
    );
    const recordBytes = await readPartitionArtifact(root, ".piopm", 65536);
    let manifest: Record<string, unknown>, record: Record<string, unknown>;
    try {
      manifest = JSON.parse(manifestBytes.content.toString("utf8"));
      record = JSON.parse(recordBytes.content.toString("utf8"));
    } catch {
      throw new PlatformIOError(
        "Invalid framework package registration.",
        "PARTITION_FRAMEWORK_UNTRUSTED",
      );
    }
    if (
      !manifest ||
      !record ||
      typeof manifest.name !== "string" ||
      !["framework-arduinoespressif32", "framework-espidf"].includes(
        manifest.name,
      ) ||
      typeof manifest.version !== "string" ||
      !manifest.version ||
      record.name !== manifest.name ||
      record.version !== manifest.version ||
      record.type !== "tool"
    )
      throw new PlatformIOError(
        "Framework registration does not match its manifest.",
        "PARTITION_FRAMEWORK_UNTRUSTED",
      );
    const relative = path.join(
      manifest.name === "framework-espidf"
        ? "components/partition_table"
        : "tools/partitions",
      filename,
    );
    try {
      const csv = await readPartitionArtifact(root, relative, 65536);
      found.push({
        root,
        tablePath: csv.identity.path,
        packageName: manifest.name,
        packageVersion: manifest.version,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const unique = [
    ...new Map(found.map((entry) => [entry.tablePath, entry])).values(),
  ];
  if (unique.length !== 1)
    throw new PlatformIOError(
      unique.length
        ? "Multiple selected frameworks contain that CSV."
        : "The selected frameworks do not contain that CSV.",
      unique.length
        ? "PARTITION_FRAMEWORK_AMBIGUOUS"
        : "PARTITION_FRAMEWORK_NOT_FOUND",
    );
  return unique[0];
}
