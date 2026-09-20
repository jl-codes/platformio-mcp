/**
 * Resolve partition table placement from explicit project/build evidence.
 * No chip/framework default is inferred when the available evidence is missing or contradictory.
 */
import { PlatformIOError } from "../utils/errors.js";
import { parsePartitionNumber } from "./esp-partitions.js";

/** One observed offset with its concrete origin for reviewable reports. */
export interface PartitionOffsetEvidence {
  source: string;
  offset: number;
}

function offset(value: unknown): number {
  const parsed =
    typeof value === "string" ? parsePartitionNumber(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > 0xfffff000 ||
    parsed % 0x1000
  )
    throw new PlatformIOError(
      "Partition table offset must be an aligned flash address.",
      "PARTITION_OFFSET_INVALID",
    );
  return parsed;
}

/** Parse only the active offset assignment from an existing ESP-IDF sdkconfig file. */
export function partitionOffsetFromSdkconfig(
  text: string,
): PartitionOffsetEvidence | null {
  if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024)
    throw new PlatformIOError(
      "sdkconfig exceeds the inspection limit.",
      "PARTITION_CONFIG_LIMIT",
    );
  const matches = text
    .split(/\r?\n/)
    .filter((line) => /^\s*CONFIG_PARTITION_TABLE_OFFSET\s*=/.test(line));
  if (!matches.length) return null;
  if (matches.length !== 1)
    throw new PlatformIOError(
      "Duplicate partition table offset in sdkconfig.",
      "PARTITION_OFFSET_AMBIGUOUS",
    );
  const value = matches[0].slice(matches[0].indexOf("=") + 1).trim();
  return {
    source: "sdkconfig:CONFIG_PARTITION_TABLE_OFFSET",
    offset: offset(value),
  };
}

/** Extract the offset of an explicitly identified binary from computed PlatformIO flash images. */
export function partitionOffsetFromFlashImages(
  images: unknown,
  tablePath: string,
  normalizePath: (value: string) => string,
): PartitionOffsetEvidence | null {
  if (!Array.isArray(images) || images.length > 256)
    throw new PlatformIOError(
      "Invalid computed flash image inventory.",
      "PARTITION_METADATA_INVALID",
    );
  const target = normalizePath(tablePath);
  const matches: PartitionOffsetEvidence[] = [];
  for (const image of images) {
    if (!image || typeof image !== "object" || Array.isArray(image))
      throw new PlatformIOError(
        "Invalid flash image entry.",
        "PARTITION_METADATA_INVALID",
      );
    const record = image as Record<string, unknown>;
    if (typeof record.path !== "string" || record.path.length > 32768)
      throw new PlatformIOError(
        "Invalid flash image path.",
        "PARTITION_METADATA_INVALID",
      );
    if (normalizePath(record.path) === target)
      matches.push({
        source: "metadata:extra.flash_images",
        offset: offset(record.offset),
      });
  }
  if (matches.length > 1)
    throw new PlatformIOError(
      "Partition binary appears more than once in flash images.",
      "PARTITION_OFFSET_AMBIGUOUS",
    );
  return matches[0] ?? null;
}

/** Resolve generation/upload evidence consistently; disagreements require configuration repair. */
export function resolvePartitionOffset(
  evidence: readonly PartitionOffsetEvidence[],
  configuredUploadOffset?: unknown,
) {
  const entries = evidence.map((entry) => ({
    source: entry.source,
    offset: offset(entry.offset),
  }));
  if (configuredUploadOffset !== undefined && configuredUploadOffset !== null)
    entries.push({
      source: "board_upload.partition_table_offset",
      offset: offset(configuredUploadOffset),
    });
  if (!entries.length)
    throw new PlatformIOError(
      "Partition table location is unknown; provide its resolved offset or build metadata.",
      "PARTITION_OFFSET_REQUIRED",
    );
  if (new Set(entries.map((entry) => entry.offset)).size !== 1)
    throw new PlatformIOError(
      "Partition table generation and upload offsets disagree.",
      "PARTITION_OFFSET_CONFLICT",
    );
  return { tableOffset: entries[0].offset, evidence: entries };
}
