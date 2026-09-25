/** Retain bounded, redacted command output under the application's private data directory. */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { SERVER_DATA_DIR } from "./paths.js";
import { redactSecretsInText } from "../core/policy/redact.js";
import { PlatformIOError } from "./errors.js";

/** Persist completed authorized-operation output without caller-controlled filenames or overwrite. */
export async function retainCommandLog(
  purpose: "initialization" | "program-size" | "clean" | "build" | "check" | "test" | "target",
  stdout: string,
  stderr: string,
): Promise<string> {
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 16 * 1024 * 1024)
    throw new PlatformIOError(
      "Command log exceeds its bound.",
      "COMMAND_LOG_LIMIT",
    );
  const output = redactSecretsInText(stdout + "\n" + stderr);
  const directory = path.join(SERVER_DATA_DIR, "command-logs");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(
    directory,
    `${purpose}-${crypto.randomUUID()}.log`,
  );
  await fs.writeFile(filename, output, { flag: "wx", mode: 0o600 });
  return filename;
}


/** Read a trusted completed spool file through one descriptor with a fixed allocation bound. */
export async function readCommandOutput(filename: string): Promise<string> {
  const handle = await fs.open(filename, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024)
      throw new PlatformIOError("Command output exceeds the report limit", "COMMAND_LOG_LIMIT");
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    if (offset !== stat.size)
      throw new PlatformIOError("Command output changed during collection", "COMMAND_LOG_CHANGED");
    return redactSecretsInText(buffer.subarray(0, offset).toString("utf8")).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  } finally { await handle.close(); }
}
