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
    samples.push({ line, metric, value, unit, ...(task ? { task } : {}) });
  };
  lines.forEach((raw, line) => {
    const text = raw.replace(/\x1b\[[0-9;]*m/g, "");
    const heap =
      /\bFree\s+heap\s*:\s*(\d+)\b(?:\s+min\s*:\s*(\d+)\b)?(?:\s+largest\s*:\s*(\d+)\b)?/i.exec(
        text,
      );
    if (heap) {
      add(line, "free_heap", heap[1], "bytes");
      if (heap[2]) add(line, "min_free_heap", heap[2], "bytes");
      if (heap[3]) add(line, "largest_free_block", heap[3], "bytes");
      formats.add("arduino_heap");
    }
    const stack =
      /(?:^|\s)([A-Za-z0-9_.-]{1,128}):\s*stack\s+hwm\s*[:=]?\s*(\d+)\b(?:\s*(bytes|words)\b)?/i.exec(
        text,
      );
    if (stack) {
      const unit = stack[3]?.toLowerCase() ?? settings.stackUnit;
      const known =
        unit === "bytes" ||
        (unit === "words" && settings.stackWordBytes !== undefined);
      add(
        line,
        "stack_free",
        stack[2],
        known ? "bytes" : "unknown",
        stack[1],
        unit === "words" && known ? settings.stackWordBytes : 1,
      );
      formats.add("stack_high_water_mark");
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
