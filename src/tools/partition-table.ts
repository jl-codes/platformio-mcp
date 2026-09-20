/**
 * Authorized offline partition inspection shared by public adapters.
 * Explicit artifact paths and table offsets avoid hidden compilation or framework guesses.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getSystemInfo } from "./projects.js";
import { resolveFrameworkPartitionCsv } from "../core/esp-partition-framework.js";
import { readEspFlash } from "../core/esp-flash-read.js";
import { parseEspPartitionBinary } from "../core/esp-partitions.js";
import {
  compareEspPartitions,
  projectEspPartition,
} from "../core/esp-partition-report.js";
import {
  resolveProjectPartitionInputs,
  resolvePartitionBoardInfo,
  resolveBuildPartitionInputs,
} from "./partition-project.js";
import { z } from "zod";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import {
  inspectEspPartitionArtifacts,
  readPartitionArtifact,
} from "../core/esp-partition-artifacts.js";

import {
  partitionOffsetFromSdkconfig,
  resolvePartitionOffset,
  type PartitionOffsetEvidence,
} from "../core/esp-partition-location.js";
import { PlatformIOError } from "../utils/errors.js";

/** Offline input contract; live device reads use a separately authorized workflow. */
export const PartitionTableSchema = z
  .object({
    projectDir: z.string().min(1).max(32768),
    tablePath: z.string().min(1).max(32768).optional(),
    environment: z
      .string()
      .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/)
      .max(50)
      .optional(),
    configApprovalId: z.string().max(256).optional(),
    buildMetadata: z.boolean().default(false),
    metadataApprovalId: z.string().max(256).optional(),
    systemApprovalId: z.string().max(256).optional(),
    boardApprovalId: z.string().max(256).optional(),
    format: z.enum(["csv", "binary"]).default("csv"),
    tableOffset: z.number().int().min(0).max(0xfffff000).optional(),
    sdkconfigPath: z.string().min(1).max(32768).optional(),
    flashSize: z.number().int().positive().max(0x100000000).optional(),
    firmwarePath: z.string().min(1).max(32768).optional(),
    observedTablePath: z.string().min(1).max(32768).optional(),
    readDevice: z.boolean().default(false),
    port: z.string().min(1).max(512).optional(),
    readApprovalId: z.string().max(256).optional(),
    commandApprovalId: z.string().max(256).optional(),
    approvalId: z.string().max(256).optional(),
  })
  .strict()
  .refine(
    (value) => !value.readDevice || Boolean(value.port),
    "An explicit serial port is required for a device read.",
  );

/** Gate all artifact reads and recheck policy before delivering the resulting report. */
export async function executePartitionTable(
  input: unknown,
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const params = PartitionTableSchema.parse(input);
  const projectDir = await fs.realpath(params.projectDir);
  const {
    configApprovalId,
    metadataApprovalId,
    systemApprovalId,
    boardApprovalId,
    readApprovalId,
    commandApprovalId,
    ...operation
  } = params;
  return dispatchAuthorizedAction(
    "partition_table",
    { ...operation, projectDir },
    { ...caller, workspaceDir: projectDir },
    async () => {
      const guard = createPolicyRevisionGuard(projectDir);
      await onAuthorized?.();
      guard();
      const project =
        params.buildMetadata ||
        params.tablePath === undefined ||
        params.environment !== undefined
          ? await resolveProjectPartitionInputs(
              projectDir,
              params.environment,
              { ...caller, workspaceDir: projectDir },
              configApprovalId,
            )
          : null;
      guard();
      const build = params.buildMetadata
        ? await resolveBuildPartitionInputs(
            projectDir,
            project!.environment,
            { ...caller, workspaceDir: projectDir },
            metadataApprovalId,
            params.format === "binary" ? params.tablePath : undefined,
          )
        : null;
      guard();
      const evidence: PartitionOffsetEvidence[] = [];
      if (build) evidence.push(build.offsetEvidence);
      if (params.tableOffset !== undefined)
        evidence.push({
          source: "explicit:tableOffset",
          offset: params.tableOffset,
        });
      const sdkconfigPath = params.sdkconfigPath ?? project?.sdkconfigPath;
      let sdkconfig: Awaited<ReturnType<typeof readPartitionArtifact>> | null =
        null;
      if (sdkconfigPath) {
        try {
          sdkconfig = await readPartitionArtifact(
            projectDir,
            sdkconfigPath,
            2 * 1024 * 1024,
          );
        } catch (error) {
          const optionalMissing =
            !params.sdkconfigPath &&
            !project?.sdkconfigExplicit &&
            (error as NodeJS.ErrnoException).code === "ENOENT";
          if (!optionalMissing) throw error;
        }
      }
      if (sdkconfig) {
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(
            sdkconfig.content,
          );
        } catch {
          throw new PlatformIOError(
            "sdkconfig is not valid UTF-8.",
            "PARTITION_CONFIG_INVALID",
          );
        }
        const setting = partitionOffsetFromSdkconfig(text);
        if (setting) evidence.push(setting);
      }
      const location = resolvePartitionOffset(evidence, project?.uploadOffset);
      guard();
      let tablePath =
        params.tablePath ?? build?.tablePath ?? project!.tablePath;
      let format =
        !params.tablePath && build ? ("binary" as const) : params.format;
      let trustedTableRoot: string | undefined;
      let framework: Awaited<
        ReturnType<typeof resolveFrameworkPartitionCsv>
      > | null = null;
      let tableSource = params.tablePath
        ? "explicit:tablePath"
        : build
          ? "metadata:extra.flash_images"
          : project!.tableSource;
      if (
        !params.tablePath &&
        build &&
        project?.tableSource === "board_build.partitions"
      ) {
        try {
          await readPartitionArtifact(projectDir, project.tablePath, 65536);
          tablePath = project.tablePath;
          format = "csv";
          tableSource = project.tableSource;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          const system = await dispatchAuthorizedAction(
            "system_info",
            { projectDir, approvalId: systemApprovalId },
            { ...caller, workspaceDir: projectDir },
            getSystemInfo,
          );
          guard();
          framework = await resolveFrameworkPartitionCsv(
            project.tablePath,
            build.frameworkCandidates ?? [],
            system,
            projectDir,
          );
          trustedTableRoot = framework.root;
          tablePath = framework.tablePath;
          format = "csv";
          tableSource = "board_build.partitions (registered framework)";
        }
      }
      guard();
      let firmwarePath = params.firmwarePath;
      if (
        !firmwarePath &&
        build &&
        path.basename(build.tablePath).toLowerCase() === "partitions.bin"
      ) {
        const candidate = path.resolve(
          projectDir,
          path.dirname(build.tablePath),
          "firmware.bin",
        );
        const relative = path.relative(projectDir, candidate);
        if (
          relative &&
          relative !== ".." &&
          !relative.startsWith(".." + path.sep) &&
          !path.isAbsolute(relative)
        ) {
          try {
            if ((await fs.stat(candidate)).isFile()) firmwarePath = candidate;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
      }
      const boardInfo =
        project &&
        ((params.flashSize ?? project.flashSize) === undefined ||
          project.mcu === null)
          ? await resolvePartitionBoardInfo(
              projectDir,
              project.board,
              caller,
              boardApprovalId,
            )
          : null;
      guard();
      const flashSize =
        params.flashSize ??
        project?.flashSize ??
        boardInfo?.flashSize ??
        undefined;
      const flashSizeSource =
        params.flashSize !== undefined
          ? "explicit:flashSize"
          : project?.flashSize !== undefined
            ? "board_upload.flash_size"
            : boardInfo?.flashSize != null
              ? "board_catalogue"
              : "unknown";
      const result = await inspectEspPartitionArtifacts({
        workspaceDir: projectDir,
        tablePath,
        format,
        trustedTableRoot,
        layout: {
          tableOffset: location.tableOffset,
          flashSize,
        },
        firmwarePath,
        observedTablePath:
          params.observedTablePath ??
          (format === "csv" && build ? build.tablePath : undefined),
      });
      guard();
      let device: {
        port: string;
        erased: boolean;
        partitions: ReturnType<typeof projectEspPartition>[];
        diff: ReturnType<typeof compareEspPartitions>;
        log_path: string;
        sha256: string;
        offset: number;
      } | null = null;
      if (params.readDevice) {
        const read = await readEspFlash(
          {
            projectDir,
            port: params.port!,
            offset: location.tableOffset,
            length: 4096,
            approvalId: readApprovalId,
            commandApprovalId: commandApprovalId,
          },
          { ...caller, workspaceDir: projectDir },
        );
        guard();
        const observed = parseEspPartitionBinary(read.bytes, {
          tableOffset: location.tableOffset,
        });
        device = {
          port: read.port,
          erased: read.bytes.every((byte) => byte === 255),
          partitions: observed.map(projectEspPartition),
          diff: compareEspPartitions(result.partitionRecords, observed, {
            tableOffset: location.tableOffset,
          }),
          log_path: read.logPath,
          sha256: read.sha256,
          offset: read.offset,
        };
      }
      const mismatch = Boolean(
        result.comparison?.length || device?.erased || device?.diff.length,
      );
      const issues = [...result.issues];
      if (result.comparison?.length)
        issues.push({
          severity: "error",
          code: "offline_table_mismatch",
          message:
            "The supplied binary comparison differs from the expected partition layout.",
          fix: "Confirm both artifacts belong to the same build before flashing.",
        });
      if (device?.erased)
        issues.push({
          severity: "error",
          code: "device_table_erased",
          message: "The selected device partition sector is erased.",
          fix: "Verify the chip and table offset, then restore a complete approved firmware image.",
        });
      else if (device?.diff.length)
        issues.push({
          severity: "error",
          code: "device_table_mismatch",
          message:
            "The observed device table differs from the inspected partition layout.",
          fix: "Verify the selected device and rebuild or restore the intended complete flash layout.",
        });
      const errorCount = issues.filter(
        (issue) => issue.severity === "error",
      ).length;
      const { partitionRecords, ...publicResult } = result;

      return {
        ...publicResult,
        device,
        comparison_source:
          !params.observedTablePath && format === "csv" && build
            ? "build_binary"
            : publicResult.comparison_source,
        issues,
        error_count: errorCount,
        environment: project?.environment ?? null,
        table_source: tableSource,
        framework_package: framework
          ? { name: framework.packageName, version: framework.packageVersion }
          : null,
        board: project?.board ?? null,
        mcu: project?.mcu ?? boardInfo?.mcu ?? null,
        flash_size_source: flashSizeSource,
        board_lookup: boardInfo,
        offset_evidence: location.evidence,
        sdkconfig_artifact: sdkconfig?.identity ?? null,
        ok: result.ok && !mismatch,
        summary:
          partitionRecords.length +
          " partition(s) inspected from offline artifacts. " +
          (mismatch
            ? "The compared partition layout differs or is erased. "
            : "") +
          errorCount +
          " layout error(s), " +
          result.warning_count +
          " warning(s).",
      };
    },
  );
}
