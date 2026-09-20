/** Bounded ESP ELF core-note identity parsing, based on esp-coredump v1.10.0 corefile/loader.py. */
import { PlatformIOError } from "../../utils/errors.js";

/** Firmware evidence embedded by the crashed image; a prefix is not a complete artifact hash. */
export interface EspCoredumpFirmwareIdentity {
  elfSha256Prefix: string | null;
  hashBits: number;
  machine: number;
}

/** Validate an ELF32 little-endian core and extract its unique ESP application hash note. */
export function readEspCoredumpFirmwareIdentity(
  payload: Uint8Array,
  version: number,
): EspCoredumpFirmwareIdentity {
  const bytes = Buffer.from(payload);
  const invalid = (message: string): never => {
    throw new PlatformIOError(message, "COREDUMP_ELF_INVALID");
  };
  if (
    bytes.length < 52 ||
    bytes.length > 16 * 1024 * 1024 ||
    bytes.subarray(0, 7).toString("hex") !== "7f454c46010101"
  )
    return invalid("Expected a bounded ELF32 little-endian core dump.");
  if (
    bytes.readUInt16LE(16) !== 4 ||
    bytes.readUInt32LE(20) !== 1 ||
    bytes.readUInt16LE(40) !== 52
  )
    return invalid("Invalid core-dump ELF header.");
  const machine = bytes.readUInt16LE(18);
  const chip = version >>> 16;
  const expectedMachine = [0, 2, 9].includes(chip)
    ? 94
    : [5, 12, 13, 16, 18].includes(chip)
      ? 243
      : null;
  if (machine !== expectedMachine)
    return invalid("Core-dump ELF machine does not match its chip.");
  const table = bytes.readUInt32LE(28),
    count = bytes.readUInt16LE(44);
  if (
    !count ||
    count > 4096 ||
    bytes.readUInt16LE(42) !== 32 ||
    table < 52 ||
    table + count * 32 > bytes.length
  )
    return invalid("Invalid core-dump program-header table.");
  let hash: string | null = null;
  let notes = 0;
  const ranges: Array<[number, number]> = [];
  for (let index = 0; index < count; index++) {
    const header = table + index * 32;
    const type = bytes.readUInt32LE(header),
      offset = bytes.readUInt32LE(header + 4),
      size = bytes.readUInt32LE(header + 16);
    if (offset + size > bytes.length)
      return invalid("Core-dump segment extends outside the ELF.");
    if (type !== 4 || !size) continue;
    if (
      offset < table + count * 32 ||
      ranges.some(([start, end]) => offset < end && offset + size > start)
    )
      return invalid("Core-dump note segments overlap headers or each other.");
    ranges.push([offset, offset + size]);
    let cursor = offset;
    while (cursor < offset + size) {
      if (++notes > 4096 || cursor + 12 > offset + size)
        return invalid("Truncated or excessive core-dump notes.");
      const nameSize = bytes.readUInt32LE(cursor),
        descSize = bytes.readUInt32LE(cursor + 4),
        noteType = bytes.readUInt32LE(cursor + 8);
      const nameStart = cursor + 12,
        descStart = nameStart + Math.ceil(nameSize / 4) * 4;
      const end = descStart + Math.ceil(descSize / 4) * 4;
      if (end > offset + size)
        return invalid("Core-dump note exceeds its segment.");
      const name = bytes
        .subarray(nameStart, nameStart + nameSize)
        .toString("latin1")
        .split("\0")[0];
      if (name === "ESP_CORE_DUMP_INFO" && noteType === 8266) {
        if (
          hash !== null ||
          descSize < 68 ||
          bytes.readUInt32LE(descStart) !== version
        )
          return invalid(
            "Duplicate, truncated or inconsistent ESP firmware identity note.",
          );
        const rawHash = bytes.subarray(descStart + 4, descStart + 68);
        const zero = rawHash.indexOf(0);
        const prefix = rawHash
          .subarray(0, zero < 0 ? 64 : zero)
          .toString("latin1");
        if (
          !/^[a-fA-F0-9]{1,64}$/.test(prefix) ||
          (zero >= 0 && rawHash.subarray(zero).some((value) => value !== 0))
        )
          return invalid("Invalid ESP firmware hash prefix.");
        hash = prefix.toLowerCase();
      }
      cursor = end;
    }
  }
  return { elfSha256Prefix: hash, hashBits: (hash?.length ?? 0) * 4, machine };
}

/** Reject a different selected ELF, while distinguishing prefix evidence from a complete match. */
export function matchEspCoredumpFirmware(
  identity: EspCoredumpFirmwareIdentity,
  elfSha256: string,
) {
  if (!/^[a-f0-9]{64}$/i.test(elfSha256))
    throw new PlatformIOError(
      "Expected ELF identity must be SHA-256.",
      "COREDUMP_IDENTITY_INVALID",
    );
  if (!identity.elfSha256Prefix)
    return { status: "unavailable" as const, hashBits: 0 };
  if (!elfSha256.toLowerCase().startsWith(identity.elfSha256Prefix))
    throw new PlatformIOError(
      "Selected ELF does not match the firmware identity in the dump.",
      "COREDUMP_ELF_MISMATCH",
    );
  return {
    status:
      identity.hashBits === 256
        ? ("matched" as const)
        : ("prefix_matched" as const),
    hashBits: identity.hashBits,
  };
}
