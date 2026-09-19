/** Firmware crash and size report engines; adapters must supply authorized build context. */
import { PlatformIOError } from "../../utils/errors.js";
import {
  extractCrash,
  parseAddr2line,
  type SymbolizedAddress,
} from "./crash-parser.js";
import {
  parseNm,
  parseSizeSections,
  parseSizeTotals,
  groupSymbolsByFile,
} from "./size-parser.js";
import { runAnalysisProcess } from "./analysis-process.js";
import { resolveAnalysisToolchain } from "./toolchain-resolver.js";
import { withElfSnapshot } from "./elf-snapshot.js";

/** Host-resolved build context. Trusted roots must never come from untrusted tool arguments. */
export interface FirmwareAnalysisContext {
  projectDir: string;
  environment: string;
  elfPath: string;
  compilerPath: string;
  trustedToolchainRoots: readonly string[];
  expectedElfSha256?: string;
  signal?: AbortSignal;
}

/** Shares one process-execution deadline across every utility in a report. */
function executionOptions(context: FirmwareAnalysisContext, deadline: number) {
  const timeoutMs = deadline - Date.now();
  if (timeoutMs <= 0)
    throw new PlatformIOError(
      "Analysis report exceeded its execution deadline.",
      "ANALYSIS_TIMEOUT",
    );
  return { cwd: context.projectDir, signal: context.signal, timeoutMs };
}

/** Decodes crash addresses against one verified ELF snapshot, retaining unresolved frames. */
export async function decodeFirmwareCrash(
  context: FirmwareAnalysisContext,
  text: string,
  includeAllHex = false,
) {
  const crash = extractCrash(text, includeAllHex);
  if (!crash.addresses.length)
    return { ok: false as const, error: "no_addresses", ...crash, frames: [] };
  const deadline = Date.now() + 30_000;
  const tools = await resolveAnalysisToolchain(
    context.compilerPath,
    context.trustedToolchainRoots,
  );
  return withElfSnapshot(
    context.elfPath,
    context.expectedElfSha256,
    async (snapshot, identity) => {
      const addresses = [
        ...new Set(crash.addresses.map((frame) => frame.address)),
      ];
      // Bounded batches stay below Windows command-line limits even for large dumps.
      const decoded = new Map<string, SymbolizedAddress>();
      for (let index = 0; index < addresses.length; index += 128) {
        const result = await runAnalysisProcess(
          tools.addr2line,
          ["-pfiaC", "-e", snapshot, ...addresses.slice(index, index + 128)],
          executionOptions(context, deadline),
        );
        for (const [address, frame] of parseAddr2line(result.stdout))
          decoded.set(address, frame);
      }
      const frames = crash.addresses.map((frame) => {
        const symbol = decoded.get(frame.address);
        return {
          ...frame,
          function: symbol?.function ?? null,
          file: symbol?.file ?? null,
          line: symbol?.line ?? null,
          resolved: symbol?.resolved ?? false,
          inlined: symbol?.inlined ?? [],
        };
      });
      return {
        ok: frames.some((frame) => frame.resolved),
        environment: context.environment,
        elf: identity,
        artifactIdentity: context.expectedElfSha256
          ? ("matched_expected_elf" as const)
          : ("current_elf_only" as const),
        flashedFirmwareVerified: false as const,
        ...crash,
        frames,
      };
    },
  );
}

/** Reports static section and symbol sizes without presenting estimates as device capacities. */
export async function reportFirmwareSize(
  context: FirmwareAnalysisContext,
  top = 25,
) {
  if (!Number.isInteger(top) || top < 1 || top > 1000)
    throw new PlatformIOError(
      "Top-symbol count must be between 1 and 1000.",
      "ANALYSIS_ARGUMENT_INVALID",
    );
  const deadline = Date.now() + 30_000;
  const tools = await resolveAnalysisToolchain(
    context.compilerPath,
    context.trustedToolchainRoots,
  );
  return withElfSnapshot(
    context.elfPath,
    context.expectedElfSha256,
    async (snapshot, identity) => {
      const sectionsOutput = await runAnalysisProcess(
        tools.size,
        ["-A", snapshot],
        executionOptions(context, deadline),
      );
      const totalsOutput = await runAnalysisProcess(
        tools.size,
        ["-B", snapshot],
        executionOptions(context, deadline),
      );
      const symbolsOutput = await runAnalysisProcess(
        tools.nm,
        ["-S", "-C", "-l", "--size-sort", "--defined-only", snapshot],
        executionOptions(context, deadline),
      );
      const sections = parseSizeSections(sectionsOutput.stdout);
      const totals = parseSizeTotals(totalsOutput.stdout);
      if (!totals)
        throw new PlatformIOError(
          "GNU size did not produce totals for the selected image.",
          "ANALYSIS_SIZE_INVALID",
        );
      const symbols = parseNm(symbolsOutput.stdout);
      const files = groupSymbolsByFile(symbols, context.projectDir);
      return {
        ok: true as const,
        environment: context.environment,
        elf: identity,
        memorySource: "estimate_from_size" as const,
        totals,
        sections,
        symbolCount: symbols.length,
        topSymbols: symbols.slice(0, top),
        topFiles: files.slice(0, top),
        notes: [
          "Static RAM excludes runtime stack and heap consumption.",
          "Symbol aliases can overlap; symbol attribution is not section accounting.",
          "Flash and RAM estimates are not partition-capacity measurements.",
        ],
      };
    },
  );
}
