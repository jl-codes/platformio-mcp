/** Selected-environment metadata parsing; metadata generation itself requires build authorization. */
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";
import type { FirmwareAnalysisContext } from "./firmware-analysis.js";
import { resolveAnalysisToolchain } from "./toolchain-resolver.js";

/** Only fields required to select a compiler and exact program artifact. */
export interface SelectedBuildMetadata {
  environment: string;
  compilerPath: string;
  elfPath: string;
}

/** Parses bounded PlatformIO project metadata without guessing the first of multiple environments. */
export function selectBuildMetadata(
  output: string,
  environment?: string,
): SelectedBuildMetadata {
  const invalid = (message: string): never => {
    throw new PlatformIOError(message, "ANALYSIS_METADATA_INVALID");
  };
  if (Buffer.byteLength(output) > 10 * 1024 * 1024)
    invalid("Project metadata exceeds 10 MiB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return invalid("Project metadata is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    invalid("Expected metadata keyed by environment.");
  const records = parsed as Record<string, unknown>;
  const names = Object.keys(records);
  if (!names.length || names.length > 256)
    invalid("Expected between 1 and 256 build environments.");
  if (
    environment !== undefined &&
    (!environment ||
      environment.length > 256 ||
      /[\x00-\x1f]/.test(environment))
  )
    invalid("Invalid selected environment.");
  if (environment === undefined && names.length !== 1)
    throw new PlatformIOError(
      "Select an explicit environment for analysis; project metadata contains multiple environments.",
      "ANALYSIS_ENVIRONMENT_REQUIRED",
    );
  const selected = environment ?? names[0];
  if (!Object.hasOwn(records, selected))
    invalid("Selected environment is absent from project metadata.");
  const entry = records[selected];
  if (!entry || typeof entry !== "object" || Array.isArray(entry))
    invalid("Selected environment metadata is not an object.");
  const fields = entry as Record<string, unknown>;
  const absolutePath = (field: string): string => {
    const value = fields[field];
    if (
      typeof value !== "string" ||
      !value ||
      value.length > 32768 ||
      /[\x00-\x1f]/.test(value) ||
      !path.isAbsolute(value)
    )
      return invalid(`Metadata ${field} must be an absolute native path.`);
    return path.normalize(value);
  };
  return {
    environment: selected,
    compilerPath: absolutePath("cc_path"),
    elfPath: absolutePath("prog_path"),
  };
}

/**
 * Creates report context from authorized metadata and host-owned toolchain roots.
 * Caller must authorize metadata generation as a build operation before invoking PlatformIO.
 * Roots are supplied by host/package discovery, never by public tool arguments.
 */
export async function analysisContextFromMetadata(
  projectDir: string,
  metadataOutput: string,
  trustedToolchainRoots: readonly string[],
  environment?: string,
  expectedElfSha256?: string,
): Promise<FirmwareAnalysisContext> {
  if (!path.isAbsolute(projectDir))
    throw new PlatformIOError(
      "Analysis requires an absolute project directory.",
      "ANALYSIS_METADATA_INVALID",
    );
  const selected = selectBuildMetadata(metadataOutput, environment);
  await resolveAnalysisToolchain(selected.compilerPath, trustedToolchainRoots);
  return {
    projectDir: path.normalize(projectDir),
    ...selected,
    trustedToolchainRoots: [...trustedToolchainRoots],
    expectedElfSha256,
  };
}
