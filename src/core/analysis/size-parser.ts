/** Bounded GNU size/nm parsers; estimates are not device partition or runtime heap measurements. */
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";
import { normalizeAddress } from "./crash-parser.js";

/** Section classification is an estimate until checked against ELF load segments. */
export interface SizeSection {
  section: string;
  size: number;
  address: string;
  region: "flash" | "ram" | "both" | "other";
}
/** One defined symbol, optionally associated with compiler debug information. */
export interface SizeSymbol {
  name: string;
  size: number;
  type: string;
  address: string;
  kind: "code" | "data" | "bss" | "rodata" | "weak" | "common" | "other";
  file: string | null;
  line: number | null;
}
/** Static Berkeley-format totals; RAM excludes runtime stack and heap usage. */
export interface SizeTotals {
  text: number;
  data: number;
  bss: number;
  flashEstimate: number;
  ramEstimate: number;
}
/** Symbol attribution can overlap aliases and therefore is not section accounting. */
export interface FileSymbolTotal {
  file: string;
  size: number;
  symbols: number;
  code: number;
  data: number;
  bss: number;
  rodata: number;
}

/** Reject oversized or pathological output instead of silently reporting partial totals. */
function lines(output: string): string[] {
  if (Buffer.byteLength(output) > 16 * 1024 * 1024)
    throw new PlatformIOError(
      "Size output exceeds 16 MiB.",
      "ANALYSIS_INPUT_LIMIT",
    );
  const result = output.split(/\r?\n/);
  if (result.length > 100_000 || result.some((line) => line.length > 16_384))
    throw new PlatformIOError(
      "Size output exceeds line limits.",
      "ANALYSIS_INPUT_LIMIT",
    );
  return result;
}
/** Reject totals that cannot be represented exactly in the public numeric contract. */
function exact(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new PlatformIOError(
      "Size exceeds exact numeric range.",
      "ANALYSIS_SIZE_INVALID",
    );
  return Number(value);
}

/** Parses GNU SysV section output, retaining zero-address loaded sections. */
export function parseSizeSections(output: string): SizeSection[] {
  const result: SizeSection[] = [];
  for (const line of lines(output)) {
    const match = line.match(/^\s*(\.[^\s]+)\s+(\d+)\s+(\d+)\s*$/);
    if (!match) continue;
    const [, section, rawSize, rawAddress] = match;
    const size = exact(BigInt(rawSize));
    if (
      !size ||
      /^\.(?:debug|zdebug|comment|symtab|strtab|shstrtab)(?:[._]|$)/i.test(
        section,
      )
    )
      continue;
    let region: SizeSection["region"] = "other";
    if (
      /^\.(?:dram\d*\.data|data|sdata|tdata|ramfunc|fast|iram\d*\.text)(?:\.|$)/i.test(
        section,
      )
    )
      region = "both";
    else if (
      /^\.(?:dram\d*\.(?:bss|noinit)|bss|sbss|tbss|noinit|iram\d*\.(?:text|vectors|bss|data)|rtc[._]|ccm|sram|stack|heap|tcm|dtcm|itcm|ram|ext_ram|psram|lp_ram|lpram)/i.test(
        section,
      )
    )
      region = "ram";
    else if (
      /^\.(?:flash\.|text|rodata|irom|drom|isr_vector|ARM\.exidx|ARM\.extab|init|fini|ctors|dtors|eh_frame|preinit_array|init_array|fini_array|vectors|srodata|gnu\.linkonce|got)/i.test(
        section,
      )
    )
      region = "flash";
    result.push({
      section,
      size,
      address: normalizeAddress(`0x${BigInt(rawAddress).toString(16)}`),
      region,
    });
  }
  return result.sort((a, b) => b.size - a.size);
}

/** Parses Berkeley totals for a single image; rejects ambiguous multi-image output. */
export function parseSizeTotals(output: string): SizeTotals | null {
  const rows: SizeTotals[] = [];
  for (const line of lines(output)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+/);
    if (!match) continue;
    const [text, data, bss, total] = match.slice(1).map(BigInt);
    if (text + data + bss !== total)
      throw new PlatformIOError(
        "Inconsistent GNU size totals.",
        "ANALYSIS_SIZE_INVALID",
      );
    rows.push({
      text: exact(text),
      data: exact(data),
      bss: exact(bss),
      flashEstimate: exact(text + data),
      ramEstimate: exact(data + bss),
    });
  }
  if (rows.length > 1)
    throw new PlatformIOError(
      "Expected size totals for exactly one ELF image.",
      "ANALYSIS_SIZE_INVALID",
    );
  return rows[0] ?? null;
}

/** Parses demangled GNU nm symbols, preserving names and Windows/Unicode debug paths. */
export function parseNm(output: string): SizeSymbol[] {
  const kinds: Record<string, SizeSymbol["kind"]> = {
    t: "code",
    d: "data",
    b: "bss",
    r: "rodata",
    w: "weak",
    v: "weak",
    g: "data",
    s: "bss",
    c: "common",
  };
  const result: SizeSymbol[] = [];
  for (const line of lines(output)) {
    const match = line.match(/^([0-9a-f]+)\s+([0-9a-f]+)\s+([a-z?])\s+(.*)$/i);
    if (!match) continue;
    const size = exact(BigInt(`0x${match[2]}`));
    if (!size) continue;
    const location = match[4].match(/\t(.+):(\d+)\s*$/);
    result.push({
      address: normalizeAddress(`0x${match[1]}`),
      size,
      type: match[3],
      kind: kinds[match[3].toLowerCase()] ?? "other",
      name: (location ? match[4].slice(0, location.index) : match[4]).trim(),
      file: location?.[1] ?? null,
      line: location ? exact(BigInt(location[2])) : null,
    });
  }
  return result.sort((a, b) => b.size - a.size);
}

/** Groups symbol attribution by source file without confusing adjacent directory prefixes. */
export function groupSymbolsByFile(
  symbols: SizeSymbol[],
  projectDir?: string,
): FileSymbolTotal[] {
  const totals = new Map<string, FileSymbolTotal>();
  for (const symbol of symbols) {
    let file = symbol.file ?? "<no debug info>";
    if (symbol.file && projectDir) {
      const paths = /^[a-z]:[\\/]/i.test(projectDir) ? path.win32 : path.posix;
      const relative = paths.relative(projectDir, symbol.file);
      if (
        relative &&
        relative !== ".." &&
        !relative.startsWith(`..${paths.sep}`) &&
        !paths.isAbsolute(relative)
      )
        file = relative;
    }
    const row = totals.get(file) ?? {
      file,
      size: 0,
      symbols: 0,
      code: 0,
      data: 0,
      bss: 0,
      rodata: 0,
    };
    row.size = exact(BigInt(row.size) + BigInt(symbol.size));
    row.symbols++;
    if (
      symbol.kind === "code" ||
      symbol.kind === "data" ||
      symbol.kind === "bss" ||
      symbol.kind === "rodata"
    )
      row[symbol.kind] = exact(BigInt(row[symbol.kind]) + BigInt(symbol.size));
    totals.set(file, row);
  }
  return [...totals.values()].sort((a, b) => b.size - a.size);
}
