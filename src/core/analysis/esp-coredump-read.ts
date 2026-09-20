/** Explicit core-dump partition acquisition through the shared flash-read ownership and policy gates. */
import type { EspPartition } from "../esp-partitions.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import { readEspFlash } from "../esp-flash-read.js";
import { inspectRawEspCoredump } from "./esp-coredump-input.js";
import { PlatformIOError } from "../../utils/errors.js";

/** Partition selection must come from a validated effective table, never a guessed default offset. */
export interface EspCoredumpReadInput {
  projectDir: string;
  port: string;
  partition: EspPartition;
  approvalId?: string;
  commandApprovalId?: string;
}

/** Acquire only a bounded, unencrypted core-dump partition; returned bytes stay internal. */
export async function readEspCoredumpPartition(
  input: EspCoredumpReadInput,
  caller: PolicyEvaluationContext = {},
) {
  const partition = input.partition;
  if (
    partition.type !== 1 ||
    partition.subtype !== 3 ||
    !Number.isInteger(partition.offset) ||
    partition.offset < 0 ||
    partition.offset % 4096 ||
    !Number.isInteger(partition.size) ||
    partition.size < 24 ||
    partition.size > 16 * 1024 * 1024 ||
    partition.offset + partition.size > 0x100000000 ||
    !Number.isInteger(partition.flags) ||
    partition.flags < 0 ||
    partition.flags > 0xffff
  )
    throw new PlatformIOError(
      "Select a valid bounded core-dump partition from the effective table.",
      "COREDUMP_PARTITION_INVALID",
    );
  if (partition.flags & 1)
    throw new PlatformIOError(
      "Encrypted core-dump partitions require a supported decryption workflow.",
      "COREDUMP_ENCRYPTED",
    );
  const result = await readEspFlash(
    {
      projectDir: input.projectDir,
      port: input.port,
      offset: partition.offset,
      length: partition.size,
      approvalId: input.approvalId,
      commandApprovalId: input.commandApprovalId,
    },
    caller,
  );
  const source = {
    port: result.port,
    offset: result.offset,
    length: result.length,
    sha256: result.sha256,
    logPath: result.logPath,
    partition: partition.name,
  };
  try {
    const dump = inspectRawEspCoredump(result.bytes);
    return {
      present: true as const,
      bytes: result.bytes,
      identity: dump.identity,
      source,
    };
  } catch (error) {
    if (error instanceof PlatformIOError && error.code === "COREDUMP_EMPTY")
      return { present: false as const, source };
    throw error;
  }
}
