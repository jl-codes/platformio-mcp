/** Workspace-contained core-dump input loading; callers must authorize workspace reads first. */
import fs from "node:fs/promises";
import { readEspCoredumpFirmwareIdentity } from "./esp-coredump-firmware.js";
import { readPartitionArtifact } from "../esp-partition-artifacts.js";
import { PlatformIOError } from "../../utils/errors.js";
import {
  decodeEspCoredumpBase64,
  inspectRawEspCoredump,
} from "./esp-coredump-input.js";

/** Explicit offline input selection, without device access or implicit artifact discovery. */
export interface EspCoredumpArtifactInput {
  workspaceDir: string;
  dumpPath: string;
  format: "raw" | "base64";
  expectedInputSha256?: string; // Hash of the original file, including encoding and padding.
  encrypted?: boolean;
}

/** Read and validate a bounded dump, preserving both source-file and decoded envelope identities. */
export async function readEspCoredumpArtifact(input: EspCoredumpArtifactInput) {
  if (input.format !== "raw" && input.format !== "base64")
    throw new PlatformIOError(
      "Unsupported core-dump input encoding.",
      "COREDUMP_FORMAT_UNSUPPORTED",
    );
  if (
    input.expectedInputSha256 !== undefined &&
    !/^[a-f0-9]{64}$/i.test(input.expectedInputSha256)
  )
    throw new PlatformIOError(
      "Expected core-dump input hash must be SHA-256.",
      "COREDUMP_IDENTITY_INVALID",
    );
  const root = await fs.realpath(input.workspaceDir);
  const limit =
    input.format === "raw"
      ? 16 * 1024 * 1024
      : Math.ceil((16 * 1024 * 1024) / 3) * 4 + 65536;
  const artifact = await readPartitionArtifact(root, input.dumpPath, limit);
  if (
    input.expectedInputSha256 &&
    artifact.identity.sha256 !== input.expectedInputSha256.toLowerCase()
  )
    throw new PlatformIOError(
      "Core-dump file does not match the selected artifact.",
      "COREDUMP_IDENTITY_MISMATCH",
    );
  let bytes: Uint8Array = artifact.content;
  if (input.format === "base64") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new PlatformIOError(
        "Encoded core dump is not valid UTF-8.",
        "COREDUMP_BASE64_INVALID",
      );
    }
    bytes = decodeEspCoredumpBase64(text);
  }
  return {
    ...inspectEspCoredumpContent(bytes, input.encrypted),
    source: { ...artifact.identity, format: input.format },
  };
}

/** Validate captured or decoded bytes without assigning a fictional source file. */
export function inspectEspCoredumpContent(
  bytes: Uint8Array,
  encrypted = false,
) {
  const inspected = inspectRawEspCoredump(bytes, encrypted);
  const formatVersion = inspected.identity.version & 65535;
  const headerSize =
    formatVersion === 0x102 || formatVersion === 0x103 ? 24 : 20;
  const checksumSize = inspected.identity.checksum === "sha256" ? 32 : 4;
  const firmwareIdentity =
    inspected.identity.payload_format === "elf"
      ? readEspCoredumpFirmwareIdentity(
          inspected.bytes.subarray(
            headerSize,
            inspected.bytes.length - checksumSize,
          ),
          inspected.identity.version,
        )
      : null;
  return {
    bytes: inspected.bytes,
    identity: inspected.identity,
    firmwareIdentity,
  };
}

/** Prepare an internal device capture with the same envelope and firmware-note checks as files. */
export function inspectCapturedEspCoredump(
  bytes: Uint8Array,
  expectedInputSha256?: string,
  encrypted = false,
) {
  const dump = inspectEspCoredumpContent(bytes, encrypted);
  if (
    expectedInputSha256 !== undefined &&
    (!/^[a-fA-F0-9]{64}$/.test(expectedInputSha256) ||
      dump.identity.input_sha256 !== expectedInputSha256.toLowerCase())
  )
    throw new PlatformIOError(
      "Captured dump does not match the selected input identity.",
      "COREDUMP_IDENTITY_MISMATCH",
    );
  return {
    ...dump,
    source: {
      path: null,
      size: bytes.byteLength,
      sha256: dump.identity.input_sha256,
      format: "raw" as const,
    },
  };
}
