/**
 * Bounded offline ESP-IDF partition parsing with explicit table location.
 * Format reference: ESP-IDF v5.3.2 components/partition_table/gen_esp32part.py.
 */
import { createHash } from "node:crypto";
import { PlatformIOError } from "../utils/errors.js";

/** Decoded flash region; numeric type/subtype values preserve vendor extensions. */
export interface EspPartition {
  name: string;
  type: number;
  subtype: number;
  offset: number;
  size: number;
  flags: number;
}

/** Caller supplies the resolved table offset; this layer never guesses a board default. */
export interface EspPartitionLayout {
  tableOffset: number;
  flashSize?: number;
}

const SECTOR = 0x1000;
const UINT32_END = 0x100000000;
const DATA_SUBTYPES: Record<string, number> = {
  ota: 0,
  phy: 1,
  nvs: 2,
  coredump: 3,
  nvs_keys: 4,
  efuse: 5,
  undefined: 6,
  esphttpd: 0x80,
  fat: 0x81,
  spiffs: 0x82,
  littlefs: 0x83,
};

function invalid(message: string): never {
  throw new PlatformIOError(message, "PARTITION_TABLE_INVALID");
}

function unsigned(value: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    invalid("Invalid " + label + ".");
  return value;
}

/** Parse ESP-IDF decimal/hexadecimal quantities and binary K/M suffixes. */
export function parsePartitionNumber(text: string): number {
  const match = /^(0x[0-9a-f]+|[0-9]+)([km])?$/i.exec(text.trim());
  if (!match) invalid("Invalid partition number.");
  return unsigned(
    Number(match[1]) *
      (match[2]?.toLowerCase() === "k" ? 1024 : match[2] ? 1048576 : 1),
    UINT32_END,
    "partition number",
  );
}

function validateLocation(layout: EspPartitionLayout): void {
  unsigned(layout.tableOffset, UINT32_END - SECTOR, "partition table offset");
  if (layout.tableOffset % SECTOR)
    invalid("Partition table offset is not sector aligned.");
  if (layout.flashSize !== undefined) {
    unsigned(layout.flashSize, UINT32_END, "flash size");
    if (layout.flashSize < layout.tableOffset + SECTOR)
      invalid("Partition table exceeds flash size.");
  }
}

/** Reject overlapping, overflowing, duplicate or misaligned regions before device use. */
export function validateEspPartitions(
  parts: readonly EspPartition[],
  layout: EspPartitionLayout,
): void {
  validateLocation(layout);
  if (parts.length > 95) invalid("Partition table exceeds the 95-entry limit.");
  const names = new Set<string>();
  let end = layout.tableOffset + SECTOR;
  let otaCount = 0;
  for (const part of [...parts].sort((a, b) => a.offset - b.offset)) {
    if (
      !part.name ||
      Buffer.byteLength(part.name, "utf8") > 16 ||
      /[\x00-\x1f\x7f]/.test(part.name)
    )
      invalid("Invalid partition label.");
    if (names.has(part.name)) invalid("Duplicate partition label.");
    names.add(part.name);
    unsigned(part.type, 255, "partition type");
    unsigned(part.subtype, 255, "partition subtype");
    unsigned(part.flags, 0xffffffff, "partition flags");
    unsigned(part.offset, 0xffffffff, "partition offset");
    unsigned(part.size, 0xffffffff, "partition size");
    if (!part.size || part.offset + part.size > UINT32_END)
      invalid("Invalid partition address range.");
    if (part.offset < end)
      invalid("Partition overlaps the table or another partition.");
    if (part.offset % (part.type === 0 ? 0x10000 : SECTOR))
      invalid("Partition offset is not aligned for its type.");
    if (part.type === 0 && part.size % SECTOR)
      invalid("Application size is not sector aligned.");
    if (part.type === 1 && [0, 3].includes(part.subtype) && part.flags & 2)
      invalid("OTA metadata and core-dump partitions cannot be read-only.");
    if (part.type === 1 && part.subtype === 0) {
      if (++otaCount > 1 || part.size !== 0x2000)
        invalid("Invalid OTA metadata partition.");
    }
    end = part.offset + part.size;
    if (layout.flashSize !== undefined && end > layout.flashSize)
      invalid("Partition exceeds flash size.");
  }
}

/** Parse a bounded CSV without environment expansion or execution of project code. */
export function parseEspPartitionCsv(
  text: string,
  layout: EspPartitionLayout,
): EspPartition[] {
  validateLocation(layout);
  if (Buffer.byteLength(text, "utf8") > 65536)
    invalid("Partition CSV exceeds 64 KiB.");
  const parts: EspPartition[] = [];
  let end = layout.tableOffset + SECTOR;
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const fields = line.split(",").map((field) => field.trim());
    if (fields.length < 5 || fields.length > 6)
      invalid("Expected five or six CSV columns.");
    const [name, rawType, rawSubtype, offsetText, sizeText, flagText = ""] =
      fields;
    const typeText = rawType.toLowerCase();
    const subtypeText = rawSubtype.toLowerCase();
    const type =
      typeText === "app"
        ? 0
        : typeText === "data"
          ? 1
          : parsePartitionNumber(typeText);
    let subtype: number;
    const ota = /^ota_([0-9]|1[0-5])$/.exec(subtypeText);
    if (type !== 0 && !subtypeText) subtype = 6;
    else if (type === 0 && subtypeText === "factory") subtype = 0;
    else if (type === 0 && subtypeText === "test") subtype = 0x20;
    else if (type === 0 && ota) subtype = 0x10 + Number(ota[1]);
    else if (type === 1 && Object.hasOwn(DATA_SUBTYPES, subtypeText))
      subtype = DATA_SUBTYPES[subtypeText];
    else subtype = parsePartitionNumber(subtypeText);
    const alignment = type === 0 ? 0x10000 : SECTOR;
    const offset = offsetText
      ? parsePartitionNumber(offsetText)
      : Math.ceil(end / alignment) * alignment;
    const size = sizeText.startsWith("-")
      ? parsePartitionNumber(sizeText.slice(1)) - offset
      : parsePartitionNumber(sizeText);
    let flags = 0;
    for (const flag of flagText.split(":").filter(Boolean)) {
      if (flag === "encrypted") flags |= 1;
      else if (flag === "readonly") flags |= 2;
      else invalid("Unsupported partition flag.");
    }
    parts.push({ name, type, subtype, offset, size, flags });
    if (parts.length > 95)
      invalid("Partition table exceeds the 95-entry limit.");
    end = offset + size;
  }
  validateEspPartitions(parts, layout);
  return parts;
}

/** Decode binary records, checking any MD5 record and requiring an erased terminator. */
export function parseEspPartitionBinary(
  input: Uint8Array,
  layout: EspPartitionLayout,
): EspPartition[] {
  validateLocation(layout);
  const data = Buffer.from(input);
  if (!data.length || data.length > SECTOR || data.length % 32)
    invalid("Partition binary must contain 32-byte records within one sector.");
  const parts: EspPartition[] = [];
  let checksumSeen = false;
  for (let index = 0; index < Math.min(data.length, 0xc00); index += 32) {
    const record = data.subarray(index, index + 32);
    if (record.every((byte) => byte === 255)) {
      // Bytes beyond the table's 3 KiB data region may contain a signature.
      if (
        !data
          .subarray(index, Math.min(data.length, 0xc00))
          .every((byte) => byte === 255)
      )
        invalid("Unexpected data after partition terminator.");
      validateEspPartitions(parts, layout);
      return parts;
    }
    if (record.readUInt16LE(0) === 0xebeb) {
      if (checksumSeen || !record.subarray(2, 16).every((byte) => byte === 255))
        invalid("Invalid partition checksum record.");
      if (
        !createHash("md5")
          .update(data.subarray(0, index))
          .digest()
          .equals(record.subarray(16))
      )
        invalid("Partition checksum mismatch.");
      checksumSeen = true;
      continue;
    }
    if (checksumSeen || record.readUInt16LE(0) !== 0x50aa)
      invalid("Invalid partition record magic or record order.");
    const label = record.subarray(12, 28);
    const zero = label.indexOf(0);
    let name: string;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(
        zero < 0 ? label : label.subarray(0, zero),
      );
    } catch {
      return invalid("Partition label is not valid UTF-8.");
    }
    parts.push({
      name,
      type: record[2],
      subtype: record[3],
      offset: record.readUInt32LE(4),
      size: record.readUInt32LE(8),
      flags: record.readUInt32LE(28),
    });
  }
  return invalid("Partition binary is missing its terminator.");
}
