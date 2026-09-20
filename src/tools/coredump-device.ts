/** Resolve core-dump acquisition from the authorized effective project partition table. */
import { z } from "zod";
import { PlatformIOError } from "../utils/errors.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import {
  executePartitionTable,
  PartitionTableSchema,
} from "./partition-table.js";
import { readEspCoredumpPartition } from "../core/analysis/esp-coredump-read.js";

const destinationSchema = z
  .object({
    port: z.string().min(1).max(512),
    partitionName: z.string().min(1).max(16).optional(),
    approvalId: z.string().max(256).optional(),
    commandApprovalId: z.string().max(256).optional(),
  })
  .strict();

/** Select exactly one validated core partition and return acquisition bytes only to internal callers. */
export async function acquireProjectCoredump(
  tableInput: unknown,
  destinationInput: unknown,
  caller: PolicyEvaluationContext = {},
) {
  const table = PartitionTableSchema.parse(tableInput);
  const destination = destinationSchema.parse(destinationInput);
  if (table.readDevice)
    throw new PlatformIOError(
      "Core acquisition uses project-table inspection; request live table comparison separately.",
      "COREDUMP_TABLE_INPUT_INVALID",
    );
  const report = await executePartitionTable(table, caller);
  const guard = createPolicyRevisionGuard(table.projectDir);
  guard();
  if (!report.ok || report.error_count || (report.comparison?.length ?? 0) > 0)
    throw new PlatformIOError(
      "Resolve partition layout errors before reading a core dump.",
      "COREDUMP_LAYOUT_INVALID",
    );
  const candidates = report.partitions.filter(
    (partition) =>
      partition.type === "data" &&
      partition.subtype === "coredump" &&
      (!destination.partitionName ||
        partition.name === destination.partitionName),
  );
  if (candidates.length !== 1)
    throw new PlatformIOError(
      candidates.length
        ? "Select an explicit core-dump partition name."
        : "No matching core-dump partition exists in the effective layout.",
      candidates.length
        ? "COREDUMP_PARTITION_AMBIGUOUS"
        : "COREDUMP_PARTITION_MISSING",
    );
  const selected = candidates[0];
  if (selected.unknown_flags)
    throw new PlatformIOError(
      "Core-dump partition has unsupported flags.",
      "COREDUMP_PARTITION_INVALID",
    );
  const result = await readEspCoredumpPartition(
    {
      projectDir: table.projectDir,
      ...destination,
      partition: {
        name: selected.name,
        type: 1,
        subtype: 3,
        offset: selected.offset,
        size: selected.size,
        flags:
          (selected.flags.includes("encrypted") ? 1 : 0) |
          (selected.flags.includes("readonly") ? 2 : 0),
      },
    },
    caller,
  );
  guard();
  return {
    ...result,
    layout: {
      table: report.artifacts.table,
      table_offset: report.table_offset,
      environment: report.environment,
      table_source: report.table_source,
      evidence: report.evidence,
    },
  };
}
