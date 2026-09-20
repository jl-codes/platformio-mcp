/**
 * Authorized offline partition inspection shared by public adapters.
 * Explicit artifact paths and table offsets avoid hidden compilation or framework guesses.
 */
import fs from "node:fs/promises";
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
    tablePath: z.string().min(1).max(32768),
    format: z.enum(["csv", "binary"]),
    tableOffset: z.number().int().min(0).max(0xfffff000).optional(),
    sdkconfigPath: z.string().min(1).max(32768).optional(),
    flashSize: z.number().int().positive().max(0x100000000).optional(),
    firmwarePath: z.string().min(1).max(32768).optional(),
    observedTablePath: z.string().min(1).max(32768).optional(),
    approvalId: z.string().max(256).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.tableOffset !== undefined || value.sdkconfigPath !== undefined,
    "Provide tableOffset or sdkconfigPath.",
  );

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
      const evidence: PartitionOffsetEvidence[] = [];
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
      const location = resolvePartitionOffset(evidence);
      guard();
      const result = await inspectEspPartitionArtifacts({
        workspaceDir: projectDir,
        tablePath: params.tablePath,
        format: params.format,
        layout: {
          tableOffset: location.tableOffset,
          flashSize: params.flashSize,
        },
        firmwarePath: params.firmwarePath,
        observedTablePath: params.observedTablePath,
      });
      guard();
      const mismatch = Boolean(result.comparison?.length);
      return {
        ...result,
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
