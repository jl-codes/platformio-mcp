/** ELF artifact identity for analysis; file names and modification times are not firmware identities. */
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { PlatformIOError } from "../../utils/errors.js";

/** Hash and target information for one exact ELF file. */
export interface ElfIdentity {
  path: string;
  sha256: string;
  size: number;
  bits: 32 | 64;
  byteOrder: "little" | "big";
  machine: number;
  architecture:
    | "arm"
    | "xtensa"
    | "riscv"
    | "x86"
    | "x86_64"
    | "aarch64"
    | "unknown";
  type: "executable" | "shared";
}

/**
 * Reads and hashes a bounded regular ELF file through one descriptor.
 * An expected hash comes from an artifact manifest, never a newest-file heuristic.
 * @param elfPath Exact ELF location selected for a specific build environment.
 * @param expectedSha256 Optional known artifact identity to enforce.
 */
export async function readElfIdentity(
  elfPath: string,
  expectedSha256?: string,
): Promise<ElfIdentity> {
  if (expectedSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(expectedSha256))
    throw new PlatformIOError(
      "Expected ELF hash must be SHA-256.",
      "ANALYSIS_ELF_INVALID",
    );
  const resolved = await fs.realpath(elfPath);
  const file = await fs.open(resolved, "r");
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size < 52)
      throw new PlatformIOError(
        "Expected a regular ELF file with a complete header.",
        "ANALYSIS_ELF_INVALID",
      );
    if (before.size > 256 * 1024 * 1024)
      throw new PlatformIOError("ELF exceeds 256 MiB.", "ANALYSIS_INPUT_LIMIT");
    const header = Buffer.alloc(Math.min(64, before.size));
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (
      bytesRead !== header.length ||
      header.subarray(0, 4).toString("hex") !== "7f454c46" ||
      ![1, 2].includes(header[4]) ||
      ![1, 2].includes(header[5]) ||
      header[6] !== 1
    )
      throw new PlatformIOError(
        "Invalid or unsupported ELF header.",
        "ANALYSIS_ELF_INVALID",
      );
    const bits = header[4] === 1 ? 32 : 64;
    const byteOrder = header[5] === 1 ? "little" : "big";
    if (bits === 64 && bytesRead < 64)
      throw new PlatformIOError(
        "Truncated ELF64 header.",
        "ANALYSIS_ELF_INVALID",
      );
    const u16 = (offset: number) =>
      byteOrder === "little"
        ? header.readUInt16LE(offset)
        : header.readUInt16BE(offset);
    const version =
      byteOrder === "little"
        ? header.readUInt32LE(20)
        : header.readUInt32BE(20);
    const type = u16(16);
    if (
      version !== 1 ||
      u16(bits === 32 ? 40 : 52) !== (bits === 32 ? 52 : 64) ||
      ![2, 3].includes(type)
    )
      throw new PlatformIOError(
        "ELF must be a supported executable or shared image.",
        "ANALYSIS_ELF_INVALID",
      );
    const machine = u16(18);
    const architectures: Record<number, ElfIdentity["architecture"]> = {
      3: "x86",
      40: "arm",
      62: "x86_64",
      94: "xtensa",
      183: "aarch64",
      243: "riscv",
    };
    const hash = crypto.createHash("sha256");
    const chunk = Buffer.alloc(64 * 1024);
    let position = 0;
    while (position < before.size) {
      const read = await file.read(
        chunk,
        0,
        Math.min(chunk.length, before.size - position),
        position,
      );
      if (!read.bytesRead)
        throw new PlatformIOError(
          "ELF changed while reading.",
          "ANALYSIS_ELF_CHANGED",
        );
      hash.update(chunk.subarray(0, read.bytesRead));
      position += read.bytesRead;
    }
    const after = await file.stat();
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw new PlatformIOError(
        "ELF changed while reading.",
        "ANALYSIS_ELF_CHANGED",
      );
    const sha256 = hash.digest("hex");
    if (expectedSha256 && sha256 !== expectedSha256.toLowerCase())
      throw new PlatformIOError(
        "ELF does not match the selected firmware artifact.",
        "ANALYSIS_ELF_MISMATCH",
      );
    return {
      path: resolved,
      sha256,
      size: before.size,
      bits,
      byteOrder,
      machine,
      architecture: architectures[machine] ?? "unknown",
      type: type === 2 ? "executable" : "shared",
    };
  } finally {
    await file.close();
  }
}
