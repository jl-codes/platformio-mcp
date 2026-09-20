/** Workspace-contained core-dump input loading; callers must authorize workspace reads first. */
import fs from "node:fs/promises";
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
  const inspected = inspectRawEspCoredump(bytes, input.encrypted);
  return {
    bytes: inspected.bytes,
    identity: inspected.identity,
    source: { ...artifact.identity, format: input.format },
  };
}

