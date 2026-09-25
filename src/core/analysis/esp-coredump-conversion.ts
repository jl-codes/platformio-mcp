/** Execute the pinned optional file converter in private, bounded temporary storage. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PlatformIOError } from "../../utils/errors.js";
import { readPartitionArtifact } from "../esp-partition-artifacts.js";
import { runAnalysisProcess } from "./analysis-process.js";
import { withPrivateAnalysisDirectory } from "./private-analysis-directory.js";
import {
  ESP_COREDUMP_CONVERTER,
  ESP_COREDUMP_VERSION,
} from "./esp-coredump-converter.js";
import type { EspCoredumpAnalysisArtifacts } from "./esp-coredump-analysis.js";

/** Host-authorized Python selection; never deserialize this executable path from MCP arguments. */
export interface EspCoredumpConversionOptions {
  pythonExecutable: string;
  validatePolicy: () => void;
  signal?: AbortSignal;
}

/** Provide a validated core ELF only for the lifetime of the callback; stop all consumers before returning. */
export async function withConvertedEspCoredump<T>(
  artifacts: EspCoredumpAnalysisArtifacts,
  options: EspCoredumpConversionOptions,
  use: (corePath: string, sha256: string) => Promise<T>,
): Promise<T> {
  options.validatePolicy();
  if (
    createHash("sha256").update(artifacts.dump.bytes).digest("hex") !==
    artifacts.dump.identity.sha256
  )
    throw new PlatformIOError(
      "Core-dump bytes changed before conversion.",
      "COREDUMP_IDENTITY_MISMATCH",
    );
  return withPrivateAnalysisDirectory(async (directory) => {
    const raw = path.join(directory, "dump.raw");
    await fs.writeFile(raw, artifacts.dump.bytes, { flag: "wx", mode: 0o600 });
    options.validatePolicy();
    const result = await runAnalysisProcess(
      options.pythonExecutable,
      [
        "-I",
        "-c",
        ESP_COREDUMP_CONVERTER,
        raw,
        artifacts.elfPath,
        directory,
        String(artifacts.elfIdentity.machine),
      ],
      {
        cwd: directory,
        signal: options.signal,
        timeoutMs: 60000,
        maxOutputBytes: 65536,
        allowedExitCodes: [2],
      },
    );
    let response: unknown;
    try {
      response = JSON.parse(result.stdout);
    } catch {
      throw new PlatformIOError(
        "Converter returned an invalid response.",
        "COREDUMP_CONVERSION_INVALID",
      );
    }
    if (!response || typeof response !== "object")
      throw new PlatformIOError(
        "Converter returned an invalid response.",
        "COREDUMP_CONVERSION_INVALID",
      );
    const report = response as Record<string, unknown>;
    const errors = new Set([
      "COREDUMP_TOOL_UNAVAILABLE",
      "COREDUMP_TOOL_VERSION_MISMATCH",
      "COREDUMP_CONVERTER_ARGUMENTS",
      "COREDUMP_ELF_TARGET_MISMATCH",
      "COREDUMP_INPUT_LIMIT",
      "COREDUMP_CONVERSION_INVALID",
      "COREDUMP_CONVERSION_FAILED",
    ]);
    if (typeof report.error === "string" && errors.has(report.error))
      throw new PlatformIOError(
        "Optional core-dump conversion did not complete.",
        report.error,
      );
    if (
      result.exitCode ||
      report.converter_version !== ESP_COREDUMP_VERSION ||
      typeof report.core_path !== "string"
    )
      throw new PlatformIOError(
        "Converter returned an invalid result.",
        "COREDUMP_CONVERSION_INVALID",
      );
    const core = await readPartitionArtifact(
      await fs.realpath(directory),
      report.core_path,
      32 * 1024 * 1024,
    );
    if (
      core.content.length < 52 ||
      core.content.subarray(0, 7).toString("hex") !== "7f454c46010101" ||
      core.content.readUInt16LE(16) !== 4 ||
      core.content.readUInt16LE(18) !== artifacts.elfIdentity.machine
    )
      throw new PlatformIOError(
        "Converter output is not the expected core ELF.",
        "COREDUMP_CONVERSION_INVALID",
      );
    options.validatePolicy();
    const value = await use(core.identity.path, core.identity.sha256);
    options.validatePolicy();
    return value;
  });
}
