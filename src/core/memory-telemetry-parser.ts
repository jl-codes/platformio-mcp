/** Bounded built-in heap and stack telemetry parsing with explicit unit provenance. */
import { z } from "zod";
import { PlatformIOError } from "../utils/errors.js";
/** A parsed observation keeps its source line and units; unknown stack units are never guessed. */
export interface MemoryTelemetrySample {
  line: number;
  metric: string;
  value: number;
  unit: "bytes" | "unknown";
  task?: string;
}
/** Parse common Arduino/ESP heap prints and stack high-water marks without evaluating caller regexes. */
export function parseMemoryTelemetry(
  lines: readonly string[],
  options: { stackUnit?: "bytes" | "words"; stackWordBytes?: number } = {},
) {
  const settings = z
    .object({
      stackUnit: z.enum(["bytes", "words"]).optional(),
      stackWordBytes: z.number().int().min(1).max(16).optional(),
    })
    .strict()
    .parse(options);
  if (settings.stackUnit === "words" && settings.stackWordBytes === undefined)
    throw new PlatformIOError(
      "Word-valued stack telemetry requires stackWordBytes.",
      "MEMORY_UNIT_REQUIRED",
    );
  if (
    lines.length > 10000 ||
    lines.some((line) => typeof line !== "string" || line.length > 16384) ||
    lines.reduce((size, line) => size + Buffer.byteLength(line), 0) >
      1024 * 1024
  )
    throw new PlatformIOError(
      "Telemetry exceeds line or byte limits.",
      "MEMORY_TELEMETRY_LIMIT",
    );
  const samples: MemoryTelemetrySample[] = [];
  const formats = new Set<string>();
  const add = (
    line: number,
    metric: string,
    raw: string,
    unit: "bytes" | "unknown",
    task?: string,
    scale = 1,
  ) => {
    const value = Number(raw) * scale;
    if (!Number.isSafeInteger(value) || value < 0)
      throw new PlatformIOError(
        "Telemetry value is outside integer bounds.",
        "MEMORY_VALUE_INVALID",
      );
    if (samples.length >= 10000)
      throw new PlatformIOError(
        "Telemetry exceeds observation limits.",
        "MEMORY_TELEMETRY_LIMIT",
      );
    samples.push({ line, metric, value, unit, ...(task ? { task } : {}) });
  };
  let heapSummaryUntil = -1,
    totalsPending = false,
    taskTable = false;
  lines.forEach((raw, line) => {
    const text = raw.replace(/\x1b\[[0-9;]*m/g, "");
    const trimmed = text.trim();
    if (/heap summary for capabilities/i.test(trimmed)) {
      heapSummaryUntil = line + 128;
      totalsPending = false;
      return;
    }
    if (line <= heapSummaryUntil) {
      if (/^Totals\s*:/i.test(trimmed)) totalsPending = true;
      const totals =
        /\bfree\s+(\d+)\s+allocated\s+(\d+)(?:\s+min_free\s+(\d+))?(?:\s+largest_free_block\s+(\d+))?\s*$/i.exec(
          trimmed,
        );
      if (totals && totalsPending) {
        add(line, "free_heap", totals[1], "bytes");
        add(line, "allocated", totals[2], "bytes");
        if (totals[3]) add(line, "min_free_heap", totals[3], "bytes");
        if (totals[4]) add(line, "largest_free_block", totals[4], "bytes");
        formats.add("esp_idf_heap_info");
        heapSummaryUntil = -1;
        totalsPending = false;
        return;
      }
      if (
        /^(?:Totals\s*:|at 0x|largest_free_block\b|alloc_blocks\b)/i.test(
          trimmed,
        ) ||
        totals ||
        !trimmed
      )
        return;
      heapSummaryUntil = -1;
      totalsPending = false;
    }
    if (
      /^Name\s+State\s+Prio(?:rity)?\s+Stack\s+(?:Num|#|Task\s+Number)\s*$/i.test(
        trimmed,
      )
    ) {
      taskTable = true;
      return;
    }
    if (taskTable) {
      const row = /^(\S{1,128})\s+[XRBSD]\s+\d+\s+(\d+)\s+\d+\s*$/.exec(
        trimmed,
      );
      if (row) {
        const known =
          settings.stackUnit === "bytes" || settings.stackUnit === "words";
        add(
          line,
          "stack_free",
          row[2],
          known ? "bytes" : "unknown",
          row[1],
          settings.stackUnit === "words" ? settings.stackWordBytes : 1,
        );
        formats.add("freertos_task_table");
        return;
      }
      if (/^[-= ]+$/.test(trimmed)) return;
      if (/^[-= ]+$/.test(trimmed)) return;
      taskTable = false;
    }
    // Match specific labels first so a minimum-heap label is not also counted as free heap.
    const heapMatches: Array<{ metric: string; match: RegExpExecArray }> = [];
    const claimed: Array<[number, number]> = [];
    const heapNumber = String.raw`\s*(?:[:=]|\bis\b)?\s*(\d+)\b(?![.eE])(?:\s*(KiB|KB|MB|bytes?|B|words?)\b)?`;
    const heapPatterns: Array<[string, string, boolean]> = [
      [
        "min_free_heap",
        String.raw`(?:min(?:imum)?[\s_.]*free[\s_]*(?:internal[\s_]*)?heap(?:[\s_]*size)?|free[\s_]*heap[\s_]*min(?:imum)?|lowest[\s_]*free[\s_]*heap|ESP\.getMinFreeHeap\(\)|esp_get_minimum_free_heap_size\(\)|minFreeHeap|min_free(?![\s_]*block))`,
        false,
      ],
      [
        "largest_free_block",
        String.raw`(?:largest[\s_]*free[\s_]*block|largest[\s_]*(?:free[\s_]*)?(?:block|alloc(?:atable)?)|max(?:imum)?[\s_]*alloc(?:atable)?(?:[\s_]*heap|[\s_]*block|[\s_]*size)?|ESP\.getMaxAllocHeap\(\)|maxAllocHeap|biggest[\s_]*free[\s_]*block)`,
        false,
      ],
      [
        "psram_free",
        String.raw`(?:free[\s_]*psram|psram[\s_]*free|ESP\.getFreePsram\(\)|freePsram|free_psram)`,
        false,
      ],
      [
        "allocated",
        String.raw`(?:allocated(?:[\s_]*heap)?|heap[\s_]*used|used[\s_]*heap)`,
        false,
      ],
      [
        "free_heap",
        String.raw`(?:free[\s_]*(?:internal[\s_]*|dram[\s_]*)?heap(?:[\s_]*size)?|heap[\s_]*free|ESP\.getFreeHeap\(\)|esp_get_free_heap_size\(\)|freeHeap|free_heap|\bheap)`,
        false,
      ],
      ["min_free_heap", String.raw`\bmin`, true],
      ["largest_free_block", String.raw`\blargest`, true],
    ];
    for (const [metric, label, trailer] of heapPatterns) {
      if (trailer && heapMatches.length === 0) continue;
      const regex = new RegExp(label + heapNumber, "gi");
      for (const match of text.matchAll(regex)) {
        const end = match.index + match[0].length;
        if (claimed.some(([a, b]) => match.index < b && end > a)) continue;
        claimed.push([match.index, end]);
        heapMatches.push({ metric, match });
      }
    }
    heapMatches.sort((a, b) => a.match.index - b.match.index);
    for (const { metric, match } of heapMatches) {
      const unit = match[2]?.toLowerCase();
      const words = unit === "word" || unit === "words";
      const scale = words
        ? settings.stackWordBytes
        : unit === "mb"
          ? 1024 * 1024
          : unit === "kb" || unit === "kib"
            ? 1024
            : 1;
      add(
        line,
        metric,
        match[1],
        scale === undefined ? "unknown" : "bytes",
        undefined,
        scale ?? 1,
      );
      formats.add("arduino_heap");
    }
    const stackNumber = String.raw`(?<value>\d+)\b(?![.eE])(?:\s*(?<unit>KiB|KB|MB|bytes?|B|words?)\b)?`;
    const stackPatterns = [
      String.raw`(?:(?<task>[\w.-]{1,128})\s*[:\-]\s*)?(?:stack[\s_]*(?:hwm|high[\s_-]*water[\s_-]*mark|free|headroom|remaining|left)|high[\s_-]*water[\s_-]*mark|uxTaskGetStackHighWaterMark(?:\((?<arg>[^)]{0,128})\))?)(?:\s*(?:for|of)\s+(?<task2>[\w.-]{1,128}))?(?:\s*\((?<task3>[^)]{1,128})\))?\s*(?:[:=]|\bis\b)?\s*` +
        stackNumber,
      String.raw`^\s*(?<task>[\w.-]{1,128})\s*[:=]\s*` +
        stackNumber +
        String.raw`\s*(?:free|left|remaining)\b`,
    ];
    for (const pattern of stackPatterns) {
      for (const match of text.matchAll(new RegExp(pattern, "gi"))) {
        const end = match.index + match[0].length;
        if (claimed.some(([a, b]) => match.index < b && end > a)) continue;
        const groups = match.groups!;
        const task = (
          groups.task ||
          groups.task2 ||
          groups.task3 ||
          (groups.arg?.trim().toUpperCase() !== "NULL"
            ? groups.arg
            : undefined) ||
          "unknown"
        ).trim();
        if (/heap|psram|dram|iram/i.test(task)) continue;
        const unit = groups.unit?.toLowerCase() ?? settings.stackUnit;
        const scale =
          unit === "words" || unit === "word"
            ? settings.stackWordBytes
            : unit === "kib" || unit === "kb"
              ? 1024
              : unit === "mb"
                ? 1024 * 1024
                : unit === "bytes" || unit === "byte" || unit === "b"
                  ? 1
                  : undefined;
        add(
          line,
          "stack_free",
          groups.value,
          scale === undefined ? "unknown" : "bytes",
          task,
          scale ?? 1,
        );
        claimed.push([match.index, end]);
        formats.add("stack_high_water_mark");
      }
    }
    if (claimed.length === 0) {
      const generic = new RegExp(
        String.raw`(?<name>(?:[A-Za-z_][\w .-]{0,40}?)?(?:heap|stack|psram)[\w .-]{0,30}?)\s*[:=]\s*` +
          stackNumber,
        "gi",
      );
      for (const match of text.matchAll(generic)) {
        const groups = match.groups!;
        const metric = groups.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "");
        const unit = groups.unit?.toLowerCase();
        const scale =
          unit === "word" || unit === "words"
            ? settings.stackWordBytes
            : unit === "kib" || unit === "kb"
              ? 1024
              : unit === "mb"
                ? 1024 * 1024
                : 1;
        add(
          line,
          metric,
          groups.value,
          scale === undefined ? "unknown" : "bytes",
          undefined,
          scale ?? 1,
        );
        formats.add("generic");
      }
    }
  });
  return {
    recognized: samples.length > 0,
    formats: [...formats],
    samples,
    unknownUnitSamples: samples.filter((sample) => sample.unit === "unknown")
      .length,
  };
}
