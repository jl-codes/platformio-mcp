/**
 * Read configured partition inputs from Core's resolved environment inventory.
 * Framework package discovery is separate: a missing project file never selects an unrelated package.
 */
import path from "node:path";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import { getBoardInfo } from "./boards.js";
import { partitionOffsetFromFlashImages } from "../core/esp-partition-location.js";
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
  const frameworks = Array.isArray(env.framework)
    ? env.framework
    : typeof env.framework === "string"
      ? env.framework.split(",").map((value) => value.trim())
      : [];
  let sdkconfigPath: string | undefined;
  const sdkconfigExplicit =
    env.sdkconfigPath !== undefined && env.sdkconfigPath !== null;
  if (sdkconfigExplicit) {
    if (
      typeof env.sdkconfigPath !== "string" ||
      !env.sdkconfigPath ||
      env.sdkconfigPath.length > 32768 ||
      /\$|%[^%]+%/.test(env.sdkconfigPath)
    )
      throw new PlatformIOError(
        "SDK configuration path must be resolved within the workspace.",
        "PARTITION_CONFIG_INVALID",
      );
    sdkconfigPath = env.sdkconfigPath;
  } else if (frameworks.includes("espidf")) {
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,49}$/.test(env.name))
      throw new PlatformIOError(
        "Invalid SDK configuration environment name.",
        "PARTITION_CONFIG_INVALID",
      );
    sdkconfigPath = "sdkconfig." + env.name;
  }
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
    sdkconfigPath,
    sdkconfigExplicit,
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

/** Obtain selected build partition identity only through the build-authorized metadata operation. */
export async function resolveBuildPartitionInputs(
  projectDir: string,
  environment: string,
  caller: PolicyEvaluationContext,
  approvalId?: string,
  selectedTablePath?: string,
) {
  const report = await executeProjectInspection(
    "project_metadata",
    { projectDir, environment, approvalId },
    caller,
  );
  if (
    !report.ok ||
    !("envs" in report) ||
    Array.isArray(report.envs) ||
    !report.envs
  )
    throw new PlatformIOError(
      "Build metadata is unavailable.",
      "PARTITION_METADATA_UNAVAILABLE",
    );
  const entry = report.envs[environment];
  if (
    !entry ||
    !entry.extra ||
    typeof entry.extra !== "object" ||
    Array.isArray(entry.extra)
  )
    throw new PlatformIOError(
      "Build metadata has no flash image inventory.",
      "PARTITION_METADATA_UNAVAILABLE",
    );
  const images = (entry.extra as Record<string, unknown>).flash_images;
  if (!Array.isArray(images) || images.length > 256)
    throw new PlatformIOError(
      "Invalid flash image inventory.",
      "PARTITION_METADATA_INVALID",
    );
  const normalize = (value: string) => {
    const resolved = path.resolve(projectDir, value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  let selected = selectedTablePath;
  if (!selected) {
    const candidates = images.filter(
      (image) =>
        image &&
        typeof image.path === "string" &&
        path.basename(image.path).toLowerCase() === "partitions.bin",
    );
    if (candidates.length !== 1)
      throw new PlatformIOError(
        "Select the partition binary explicitly; build metadata does not identify one unique partitions.bin.",
        "PARTITION_METADATA_AMBIGUOUS",
      );
    selected = candidates[0].path as string;
  }
  const evidence = partitionOffsetFromFlashImages(images, selected, normalize);
  if (!evidence)
    throw new PlatformIOError(
      "Selected partition binary is absent from the environment's flash images.",
      "PARTITION_METADATA_MISMATCH",
    );
  return {
    tablePath: selected,
    offsetEvidence: evidence,
    environment,
    frameworkCandidates: entry.partitionFrameworkCandidates,
  };
}

/** Optional catalogue evidence never becomes a claim that a physical chip was measured. */
export async function resolvePartitionBoardInfo(
  projectDir: string,
  boardId: unknown,
  caller: PolicyEvaluationContext,
  approvalId?: string,
) {
  if (typeof boardId !== "string" || !boardId)
    return { status: "unknown" as const, flashSize: null, mcu: null };
  try {
    const board = await dispatchAuthorizedAction(
      "get_board_info",
      { projectDir, boardId, approvalId },
      { ...caller, workspaceDir: projectDir },
      () => getBoardInfo(boardId),
    );
    const flashSize =
      typeof board?.rom === "number" &&
      Number.isSafeInteger(board.rom) &&
      board.rom > 0 &&
      board.rom <= 0x100000000
        ? board.rom
        : null;
    return {
      status: "catalogue" as const,
      flashSize,
      mcu: typeof board?.mcu === "string" ? board.mcu : null,
    };
  } catch (error) {
    const code =
      error instanceof PlatformIOError ? error.code : "BOARD_LOOKUP_FAILED";
    return {
      status:
        code === "POLICY_DENIED" || code === "APPROVAL_REQUIRED"
          ? ("not_authorized" as const)
          : ("unavailable" as const),
      flashSize: null,
      mcu: null,
      error_code: code,
    };
  }
}
