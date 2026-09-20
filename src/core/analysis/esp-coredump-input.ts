/**
 * Bounded raw ESP core-dump framing and checksum validation before analyzer execution.
 * Format source: espressif/esp-coredump v1.10.0, esp_coredump/corefile/loader.py.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { PlatformIOError } from "../../utils/errors.js";

const MAX_DUMP_BYTES = 16 * 1024 * 1024;
const chips: Record<number, string> = {
  0: "esp32",
  2: "esp32s2",
  9: "esp32s3",
  5: "esp32c3",
  12: "esp32c2",
  13: "esp32c6",
  16: "esp32h2",
  18: "esp32p4",
};
const versions: Record<
  number,
  { header: number; checksum: "crc32" | "sha256"; payload: "binary" | "elf" }
> = {
  2: { header: 20, checksum: "crc32", payload: "binary" },
  3: { header: 24, checksum: "crc32", payload: "binary" },
  0x100: { header: 20, checksum: "crc32", payload: "elf" },
  0x101: { header: 20, checksum: "sha256", payload: "elf" },
  0x102: { header: 24, checksum: "crc32", payload: "elf" },
  0x103: { header: 24, checksum: "sha256", payload: "elf" },
};
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++)
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

/** Validate and trim the declared raw dump while retaining identity for ignored partition padding. */
export function inspectRawEspCoredump(input: Uint8Array, encrypted = false) {
  if (encrypted)
    throw new PlatformIOError(
      "Encrypted core dumps require a supported decryption workflow.",
      "COREDUMP_ENCRYPTED",
    );
  if (input.byteLength > MAX_DUMP_BYTES)
    throw new PlatformIOError(
      "Core dump exceeds 16 MiB.",
      "COREDUMP_INPUT_LIMIT",
    );
  if (!input.byteLength || input.every((byte) => byte === 255))
    throw new PlatformIOError(
      "No core dump is present in the supplied bytes.",
      "COREDUMP_EMPTY",
    );
  if (input.byteLength < 16)
    throw new PlatformIOError(
      "Core dump header is truncated.",
      "COREDUMP_TRUNCATED",
    );
  const bytes = Buffer.from(input);
  const length = bytes.readUInt32LE(0);
  if (!length)
    throw new PlatformIOError(
      "Core dump length is zero; no recorded crash is available.",
      "COREDUMP_EMPTY",
    );
  const version = bytes.readUInt32LE(4),
    format = versions[version & 65535],
    chip = chips[version >>> 16];
  if (!format || !chip)
    throw new PlatformIOError(
      "Unsupported raw core-dump version or chip; do not infer plaintext from unknown bytes.",
      "COREDUMP_FORMAT_UNSUPPORTED",
    );
  const checksumLength = format.checksum === "sha256" ? 32 : 4;
  if (
    length < format.header + checksumLength ||
    length > bytes.length ||
    length > MAX_DUMP_BYTES
  )
    throw new PlatformIOError(
      "Declared core-dump length is outside the supplied input.",
      "COREDUMP_LENGTH_INVALID",
    );
  const payload = bytes.subarray(0, length - checksumLength);
  const checksum = bytes.subarray(length - checksumLength, length);
  const valid =
    format.checksum === "sha256"
      ? timingSafeEqual(createHash("sha256").update(payload).digest(), checksum)
      : crc32(payload) === checksum.readUInt32LE(0);
  if (!valid)
    throw new PlatformIOError(
      "Core-dump checksum does not match its declared bytes.",
      "COREDUMP_CHECKSUM_MISMATCH",
    );
  if (
    format.payload === "elf" &&
    (length - format.header - checksumLength < 4 ||
      !bytes
        .subarray(format.header, format.header + 4)
        .equals(Buffer.from([127, 69, 76, 70])))
  )
    throw new PlatformIOError(
      "Core-dump payload does not contain the declared ELF format.",
      "COREDUMP_PAYLOAD_INVALID",
    );
  return {
    bytes: bytes.subarray(0, length),
    identity: {
      sha256: createHash("sha256")
        .update(bytes.subarray(0, length))
        .digest("hex"),
      input_sha256: createHash("sha256").update(bytes).digest("hex"),
      length,
      input_length: bytes.length,
      trailing_bytes: bytes.length - length,
      version,
      chip,
      payload_format: format.payload,
      checksum: format.checksum,
      task_count: bytes.readUInt32LE(8),
      tcb_size: bytes.readUInt32LE(12),
      segment_count: bytes.readUInt32LE(16),
      chip_revision: format.header === 24 ? bytes.readUInt32LE(20) : null,
    },
  };
}

/** Decode strict base64 dump bytes without accepting ignored garbage or oversized decoded input. */
export function decodeEspCoredumpBase64(text: string): Buffer {
  if (
    Buffer.byteLength(text, "utf8") >
    Math.ceil(MAX_DUMP_BYTES / 3) * 4 + 65536
  )
    throw new PlatformIOError(
      "Encoded core dump exceeds the input limit.",
      "COREDUMP_INPUT_LIMIT",
    );
  const compact = text.replace(/[ \t\r\n]/g, "");
  if (!compact || compact.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact))
    throw new PlatformIOError(
      "Invalid base64 core dump.",
      "COREDUMP_BASE64_INVALID",
    );
  const decoded = Buffer.from(compact, "base64");
  if (decoded.length > MAX_DUMP_BYTES)
    throw new PlatformIOError(
      "Decoded core dump exceeds 16 MiB.",
      "COREDUMP_INPUT_LIMIT",
    );
  if (decoded.toString("base64") !== compact)
    throw new PlatformIOError(
      "Non-canonical base64 core dump.",
      "COREDUMP_BASE64_INVALID",
    );
  return decoded;
}
