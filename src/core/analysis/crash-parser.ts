/** Crash and GNU addr2line parsing with bounded input and explicit address roles. */
import { PlatformIOError } from "../../utils/errors.js";

/** One address reported by firmware, retaining its register/frame provenance. */
export interface CrashAddress {
  address: string;
  role: "pc" | "lr" | "register" | "backtrace" | "other";
  frame: number | null;
  register: string | null;
}
/** Extracted crash evidence; data and stack pointers are never promoted to call frames. */
export interface CrashEvidence {
  addresses: CrashAddress[];
  causes: string[];
  resetReasons: string[];
  backtraceCorrupted: boolean;
}
/** A source location from an ELF symbol lookup. */
export interface SymbolLocation {
  function: string | null;
  file: string | null;
  line: number | null;
}
/** Primary frame plus any inlined call-site locations. */
export interface SymbolizedAddress extends SymbolLocation {
  address: string;
  resolved: boolean;
  inlined: SymbolLocation[];
}

const HEX = "0x[0-9a-fA-F]{6,16}";
const MAX_ADDRESSES = 4096;

/** Bounds complete input without truncating away a late fault or inline frame. */
function linesOf(text: string): string[] {
  if (Buffer.byteLength(text) > 1024 * 1024)
    throw new PlatformIOError(
      "Analysis text exceeds 1 MiB.",
      "ANALYSIS_INPUT_LIMIT",
    );
  const lines = text.split(/\r?\n/);
  if (lines.some((line) => line.length > 16_384))
    throw new PlatformIOError(
      "Analysis line exceeds 16 KiB.",
      "ANALYSIS_INPUT_LIMIT",
    );
  return lines;
}

/** Normalizes up to 64-bit addresses without lossy JavaScript number conversion. */
export function normalizeAddress(address: string): string {
  if (!/^0x[0-9a-f]{1,16}$/i.test(address))
    throw new PlatformIOError(
      "Invalid hexadecimal address.",
      "ANALYSIS_ADDRESS_INVALID",
    );
  return `0x${BigInt(address).toString(16).padStart(8, "0")}`;
}

/**
 * Extracts ESP32/Xtensa, RISC-V and Cortex-M crash evidence from serial text.
 * RISC-V RA values are preserved; Xtensa window-bit correction applies only to A0.
 * @param text Complete bounded crash text.
 * @param includeAllHex Include unclassified hexadecimal values in addition to known frames.
 */
export function extractCrash(
  text: string,
  includeAllHex = false,
): CrashEvidence {
  const lines = linesOf(text);
  const evidence: CrashEvidence = {
    addresses: [],
    causes: [],
    resetReasons: [],
    backtraceCorrupted: false,
  };
  const seen = new Set<string>();
  const riscvDump = /\b(?:MEPC|MTVAL|MCAUSE)\s*[:=]/i.test(text);
  let inBacktrace = false;
  let backtraceFrame = 0;
  const add = (
    raw: string,
    role: CrashAddress["role"],
    register: string | null = null,
    frame: number | null = null,
  ) => {
    let address = normalizeAddress(raw);
    if (register === "A0" && role === "lr") {
      const value = BigInt(address);
      if (value <= 0xffffffffn && (value & 0xc0000000n) === 0x80000000n)
        address = normalizeAddress(
          `0x${((value & 0x3fffffffn) | 0x40000000n).toString(16)}`,
        );
    }
    const key = `${address}:${role}`;
    if (seen.has(key)) return;
    if (seen.size >= MAX_ADDRESSES)
      throw new PlatformIOError(
        "Crash exceeds the address limit.",
        "ANALYSIS_INPUT_LIMIT",
      );
    seen.add(key);
    evidence.addresses.push({ address, role, register, frame });
  };
  for (const line of lines) {
    for (const match of line.matchAll(
      new RegExp(
        `\\b(PC|A0|EXCVADDR|EPC[1-4]|MEPC|MTVAL|RA|r15|lr|r14|xpsr|psp|msp)\\b\\s*(?:\\((?:pc|lr)\\))?\\s*[:=]\\s*(${HEX})\\b`,
        "gi",
      ),
    )) {
      const register = match[1].toUpperCase();
      const role = ["PC", "EPC1", "MEPC", "R15"].includes(register)
        ? "pc"
        : [...(riscvDump ? [] : ["A0"]), "RA", "LR", "R14"].includes(register)
          ? "lr"
          : "register";
      add(match[2], role, register);
    }
    const traceStart = line.toLowerCase().indexOf("backtrace:");
    if (traceStart >= 0) {
      inBacktrace = true;
      backtraceFrame = 0;
    } else if (
      !new RegExp(`^\\s*(?:${HEX}:${HEX}|\\|<-CORRUPTED)`, "i").test(line)
    )
      inBacktrace = false;
    if (inBacktrace) {
      evidence.backtraceCorrupted ||= /\|<-CORRUPTED/i.test(line);
      const backtrace = traceStart >= 0 ? line.slice(traceStart + 10) : line;
      for (const pair of backtrace.matchAll(
        new RegExp(`(${HEX}):(${HEX})`, "g"),
      ))
        add(pair[1], "backtrace", null, backtraceFrame++);
    }
    const abort = line.match(
      new RegExp(`abort\\(\\) was called at PC (${HEX})`, "i"),
    );
    if (abort) add(abort[1], "pc", "abort_pc");
    const cause = line.match(
      /Guru Meditation Error:.*|abort\(\) was called at PC .*|assert failed:.*|Task watchdog got triggered.*|Brownout detector was triggered.*|E \(\d+\) task_wdt:.*|Debug exception reason:.*|panic'ed.*|CORRUPT HEAP:.*|Hard ?Fault|MemManage|Bus ?Fault|Usage ?Fault|Memory Management Fault|Stack overflow in task \S+|\*\*\* ERROR \*\*\*.*stack overflow.*/i,
    );
    if (cause && !evidence.causes.includes(cause[0].trim()))
      evidence.causes.push(cause[0].trim());
    for (const reset of line.matchAll(/rst:0x[0-9a-f]+\s*\((\w+)\)/gi))
      evidence.resetReasons.push(reset[1]);
  }
  if (includeAllHex || evidence.addresses.length === 0) {
    for (const line of lines)
      for (const match of line.matchAll(new RegExp(`\\b(${HEX})\\b`, "g")))
        add(match[1], "other");
  }
  return evidence;
}

/** Parses GNU addr2line -pfiaC output, including Windows paths and inline frames. */
export function parseAddr2line(output: string): Map<string, SymbolizedAddress> {
  const frames = new Map<string, SymbolizedAddress>();
  let current: SymbolizedAddress | undefined;
  const location = (text: string): SymbolLocation | undefined => {
    const match = text.match(
      /^(.*?)\s+at\s+(.+):(\d+|\?)(?:\s+\(discriminator \d+\))?\s*$/,
    );
    if (!match) return undefined;
    return {
      function: match[1].trim() === "??" ? null : match[1].trim(),
      file: match[2].trim() === "??" ? null : match[2].trim(),
      line: match[3] === "?" || match[3] === "0" ? null : Number(match[3]),
    };
  };
  for (const line of linesOf(output)) {
    const primary = line.match(/^(0x[0-9a-f]+):\s*(.*)$/i);
    if (primary) {
      const address = normalizeAddress(primary[1]);
      const parsed = location(primary[2]);
      current = {
        address,
        function: parsed?.function ?? null,
        file: parsed?.file ?? null,
        line: parsed?.line ?? null,
        resolved: Boolean(parsed?.function && parsed?.file),
        inlined: [],
      };
      if (frames.size >= MAX_ADDRESSES && !frames.has(address))
        throw new PlatformIOError(
          "Symbol output exceeds the address limit.",
          "ANALYSIS_INPUT_LIMIT",
        );
      frames.set(address, current);
    } else {
      const inline = line.match(/^\s*\(inlined by\)\s+(.*)$/);
      const parsed = inline ? location(inline[1]) : undefined;
      if (parsed && current) current.inlined.push(parsed);
    }
  }
  return frames;
}
