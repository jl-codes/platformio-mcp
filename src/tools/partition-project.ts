/**
 * Read configured partition inputs from Core's resolved environment inventory.
 * Framework package discovery is separate: a missing project file never selects an unrelated package.
 */
import { executeProjectInspection } from "./project-inspection.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { PlatformIOError } from "../utils/errors.js";
import { parsePartitionNumber } from "../core/esp-partitions.js";

/** Resolve an explicit or unambiguous default environment under its own configuration grant. */
export async function resolveProjectPartitionInputs(
  projectDir: string,
  environment: string | undefined,
  caller: PolicyEvaluationContext,
  approvalId?: string,
) {
  const report = await executeProjectInspection(
    "project_envs",
    { projectDir, approvalId },
    caller,
  );
  if (
    !report.ok ||
    !("defaultEnvironments" in report) ||
    !Array.isArray(report.envs)
  )
    throw new PlatformIOError(
      "Cannot resolve project partition configuration.",
      "PARTITION_CONFIG_UNAVAILABLE",
    );
  const envs = report.envs;
  const selected =
    environment ??
    (report.defaultEnvironments.length === 1
      ? report.defaultEnvironments[0]
      : undefined);
  const env = envs.find((entry) => entry.name === selected);
  if (!env)
    throw new PlatformIOError(
      "Select one configured environment for partition inspection.",
      "PARTITION_ENVIRONMENT_REQUIRED",
    );
  if (
    env.partitionTable !== null &&
    (typeof env.partitionTable !== "string" ||
      !env.partitionTable ||
      env.partitionTable.length > 32768)
  )
    throw new PlatformIOError(
      "Invalid configured partition file.",
      "PARTITION_CONFIG_INVALID",
    );
  let flashSize: number | undefined;
  if (env.flashSize !== null) {
    if (typeof env.flashSize !== "string" && typeof env.flashSize !== "number")
      throw new PlatformIOError(
        "Invalid configured flash size.",
        "PARTITION_CONFIG_INVALID",
      );
    flashSize =
      typeof env.flashSize === "number"
        ? env.flashSize
        : parsePartitionNumber(env.flashSize.replace(/B$/i, ""));
  }
  return {
    environment: env.name,
    tablePath: env.partitionTable ?? "partitions.csv",
    tableSource: env.partitionTable
      ? "board_build.partitions"
      : "project:partitions.csv",
    uploadOffset: env.partitionTableUploadOffset,
    flashSize,
    board: env.board,
    mcu: env.mcu,
  };
}
