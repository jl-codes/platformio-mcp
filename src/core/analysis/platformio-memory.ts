/** PlatformIO program-size accounting, distinct from generic GNU section estimates. */
import { PlatformIOError } from "../../utils/errors.js";

/** One region reported by PlatformIO's selected-environment size check. */
export interface ProgramMemoryRegion {
  usedBytes: number;
  totalBytes: number;
  percent: number;
}
/** Evidence must be supplied by the authorized build/size-check adapter for the same ELF. */
export interface ProgramMemoryEvidence {
  environment: string;
  elfSha256: string;
  exitCode: number;
  output: string;
}

/** Parses complete, unambiguous RAM/Flash accounting; absent formats remain explicitly unknown. */
export function parsePlatformioMemory(
  output: string,
): { ram: ProgramMemoryRegion; flash: ProgramMemoryRegion } | undefined {
  if (Buffer.byteLength(output) > 1024 * 1024)
    throw new PlatformIOError(
      "Memory accounting output exceeds 1 MiB.",
      "ANALYSIS_INPUT_LIMIT",
    );
  const regions: Partial<Record<"ram" | "flash", ProgramMemoryRegion>> = {};
  const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
  for (const line of plain.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(RAM|Flash):\s*(?:\[[^\]\r\n]*\]\s*)?(\d+(?:\.\d+)?)%\s*\(used\s+(\d+)\s+bytes\s+from\s+(\d+)\s+bytes\)\s*$/i,
    );
    if (!match) continue;
    const [, name, percentage, used, total] = match;
    const region = {
      usedBytes: Number(used),
      totalBytes: Number(total),
      percent: Number(percentage),
    };
    if (
      !Number.isSafeInteger(region.usedBytes) ||
      !Number.isSafeInteger(region.totalBytes) ||
      region.totalBytes <= 0 ||
      !Number.isFinite(region.percent) ||
      Math.abs(region.percent - (100 * region.usedBytes) / region.totalBytes) >
        0.11
    )
      throw new PlatformIOError(
        "Invalid or inconsistent PlatformIO memory accounting.",
        "ANALYSIS_MEMORY_INVALID",
      );
    const key = name.toLowerCase() as "ram" | "flash";
    if (regions[key])
      throw new PlatformIOError(
        "Multiple size-check results require explicit environment isolation.",
        "ANALYSIS_MEMORY_AMBIGUOUS",
      );
    regions[key] = region;
  }
  return regions.ram && regions.flash
    ? { ram: regions.ram, flash: regions.flash }
    : undefined;
}
