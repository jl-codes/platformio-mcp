/**
 * Authorized offline partition inspection shared by public adapters.
 * Explicit artifact paths and table offsets avoid hidden compilation or framework guesses.
 */
import fs from "node:fs/promises";
import {
  resolveProjectPartitionInputs,
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
    format: z.enum(["csv", "binary"]).default("csv"),
    tableOffset: z.number().int().min(0).max(0xfffff000).optional(),
    sdkconfigPath: z.string().min(1).max(32768).optional(),
    flashSize: z.number().int().positive().max(0x100000000).optional(),
    firmwarePath: z.string().min(1).max(32768).optional(),
    observedTablePath: z.string().min(1).max(32768).optional(),
    approvalId: z.string().max(256).optional(),
  })
  .strict();

/** Gate all artifact reads and recheck policy before delivering the resulting report. */
export async function executePartitionTable(
  input: unknown,
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const params = PartitionTableSchema.parse(input);
  const projectDir = await fs.realpath(params.projectDir);
  return dispatchAuthorizedAction(
    "partition_table",
    { ...params, projectDir },
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
              params.configApprovalId,
            )
          : null;
      guard();
      const build = params.buildMetadata
        ? await resolveBuildPartitionInputs(
            projectDir,
            project!.environment,
            { ...caller, workspaceDir: projectDir },
            params.metadataApprovalId,
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
      const sdkconfig = params.sdkconfigPath
        ? await readPartitionArtifact(
            projectDir,
            params.sdkconfigPath,
            2 * 1024 * 1024,
          )
        : null;
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
      const result = await inspectEspPartitionArtifacts({
        workspaceDir: projectDir,
        tablePath: params.tablePath ?? build?.tablePath ?? project!.tablePath,
        format: !params.tablePath && build ? "binary" : params.format,
        layout: {
          tableOffset: location.tableOffset,
          flashSize: params.flashSize ?? project?.flashSize,
        },
        firmwarePath: params.firmwarePath,
        observedTablePath: params.observedTablePath,
      });
      guard();
      const mismatch = Boolean(result.comparison?.length);
      return {
        ...result,
        environment: project?.environment ?? null,
        table_source: params.tablePath
          ? "explicit:tablePath"
          : project!.tableSource,
        board: project?.board ?? null,
        mcu: project?.mcu ?? null,
        offset_evidence: location.evidence,
        sdkconfig_artifact: sdkconfig?.identity ?? null,
        ok: result.ok && !mismatch,
        summary:
          result.partitions.length +
          " partition(s) inspected from offline artifacts. " +
          (mismatch ? "The supplied comparison table differs. " : "") +
          result.error_count +
          " layout error(s), " +
          result.warning_count +
          " warning(s).",
      };
    },
  );
}
