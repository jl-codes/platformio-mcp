/**
 * Bounded offline partition artifacts, read only after the caller's workspace permission grant.
 * File identities and content hashes bind reports to the actual bytes inspected.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PlatformIOError } from "../utils/errors.js";
import {
  parseEspPartitionBinary,
  parseEspPartitionCsv,
  type EspPartitionLayout,
} from "./esp-partitions.js";
import {
  compareEspPartitions,
  reportEspPartitions,
} from "./esp-partition-report.js";

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
}

/** Read one regular workspace artifact through a bounded handle, detecting replacement or mutation. */
export async function readPartitionArtifact(
  root: string,
  requested: string,
  limit: number,
) {
  const lexical = path.resolve(root, requested);
  const canonical = await fs.realpath(lexical);
  if (!contained(root, canonical))
    throw new PlatformIOError(
      "Partition artifact is outside the authorized workspace.",
      "PARTITION_ARTIFACT_OUTSIDE_WORKSPACE",
    );
  const handle = await fs.open(canonical, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limit)
      throw new PlatformIOError(
        "Partition artifact is not a bounded regular file.",
        "PARTITION_ARTIFACT_INVALID",
      );
    const bytes = Buffer.alloc(before.size + 1);
    let used = 0;
    while (used < bytes.length) {
      const read = await handle.read(bytes, used, bytes.length - used, used);
      if (!read.bytesRead) break;
      used += read.bytesRead;
    }
    const after = await handle.stat();
    const current = await fs.stat(canonical);
    const resolved = await fs.realpath(lexical);
    if (
      used !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      before.ino !== current.ino ||
      before.dev !== current.dev ||
      current.size !== after.size ||
      current.mtimeMs !== after.mtimeMs ||
      resolved !== canonical
    )
      throw new PlatformIOError(
        "Partition artifact changed during inspection; retry with a stable copy.",
        "PARTITION_ARTIFACT_CHANGED",
      );
    const content = bytes.subarray(0, used);
    return {
      content,
      identity: {
        path: canonical,
        size: used,
        sha256: createHash("sha256").update(content).digest("hex"),
      },
    };
  } finally {
    await handle.close();
  }
}

/** Inspect explicit offline artifacts; no metadata command, build, download or device access occurs. */
export async function inspectEspPartitionArtifacts(input: {
  workspaceDir: string;
  trustedTableRoot?: string; // Internal registered-package root; never a public request field.
  tablePath: string;
  format: "csv" | "binary";
  layout: EspPartitionLayout;
  firmwarePath?: string;
  observedTablePath?: string;
}) {
  const root = await fs.realpath(input.workspaceDir);
  const table = await readPartitionArtifact(
    input.trustedTableRoot ? await fs.realpath(input.trustedTableRoot) : root,
    input.tablePath,
    input.format === "csv" ? 65536 : 4096,
  );
  let text: string | undefined;
  if (input.format === "csv") {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(table.content);
    } catch {
      throw new PlatformIOError(
        "Partition CSV is not valid UTF-8.",
        "PARTITION_TABLE_INVALID",
      );
    }
  }
  const parts =
    input.format === "csv"
      ? parseEspPartitionCsv(text!, { tableOffset: input.layout.tableOffset })
      : parseEspPartitionBinary(table.content, {
          tableOffset: input.layout.tableOffset,
        });
  const firmware = input.firmwarePath
    ? await readPartitionArtifact(root, input.firmwarePath, 128 * 1024 * 1024)
    : null;
  const observed = input.observedTablePath
    ? await readPartitionArtifact(root, input.observedTablePath, 4096)
    : null;
  const comparison = observed
    ? compareEspPartitions(
        parts,
        parseEspPartitionBinary(observed.content, {
          tableOffset: input.layout.tableOffset,
        }),
        { tableOffset: input.layout.tableOffset },
      )
    : null;
  return {
    ...reportEspPartitions(parts, input.layout, firmware?.identity.size),
    partitionRecords: parts,
    artifacts: {
      table: table.identity,
      firmware: firmware?.identity ?? null,
      observed_table: observed?.identity ?? null,
    },
    comparison,
    // An offline copy can be stale; never label it a verified live-device match.
    comparison_source: observed ? ("offline_binary" as const) : null,
  };
}
