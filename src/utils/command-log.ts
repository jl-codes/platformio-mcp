/** Retain bounded, redacted command output under the application's private data directory. */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { SERVER_DATA_DIR } from "./paths.js";
import { redactSecretsInText } from "../core/policy/redact.js";
import { PlatformIOError } from "./errors.js";

/** Persist completed authorized-operation output without caller-controlled filenames or overwrite. */
export async function retainCommandLog(
  purpose: "initialization" | "program-size",
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
