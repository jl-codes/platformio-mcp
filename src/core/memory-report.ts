/** Aggregate bounded telemetry into evidence-qualified memory and stack reports. */
import { extractBoundedCaptures } from "./bounded-pattern.js";
import { z } from "zod";
import {
  parseMemoryTelemetry,
  type MemoryTelemetrySample,
} from "./memory-telemetry-parser.js";
import {
  memoryMetricStatistics,
  memoryFragmentation,
  type MemoryObservation,
} from "./memory-telemetry.js";
import { PlatformIOError } from "../utils/errors.js";
/** Explicit input units and timestamps for supplied telemetry. */
export interface MemoryReportOptions {
  stackUnit?: "bytes" | "words";
  stackWordBytes?: number;
  stackWarnBytes?: number;
  elapsedSeconds?: readonly number[];
}
/** Analyze supplied observations without opening hardware or interpreting unknown stack units. */
export function analyzeMemoryTelemetry(
  lines: readonly string[],
  options: MemoryReportOptions = {},
) {
  return analyzeParsedTelemetry(lines, options);
}

/** Shared aggregation for built-in and worker-extracted observations. */
function analyzeParsedTelemetry(
  lines: readonly string[],
  options: MemoryReportOptions,
  custom?: MemoryTelemetrySample[],
) {
  const settings = z
    .object({
      stackUnit: z.enum(["bytes", "words"]).optional(),
      stackWordBytes: z.number().int().min(1).max(16).optional(),
      stackWarnBytes: z
        .number()
        .int()
        .nonnegative()
        .max(1024 * 1024 * 1024)
        .default(512),
      elapsedSeconds: z
        .array(z.number().finite().nonnegative())
        .max(10000)
        .optional(),
    })
    .strict()
    .parse(options);
  if (
    settings.elapsedSeconds &&
    settings.elapsedSeconds.length !== lines.length
  )
    throw new PlatformIOError(
      "Telemetry timestamps must correspond to every input line.",
      "MEMORY_TIMESTAMPS_INVALID",
    );
  const parsed = parseMemoryTelemetry(lines, {
    stackUnit: settings.stackUnit,
    stackWordBytes: settings.stackWordBytes,
  });
  if (custom?.length) {
    const claimed = new Set(
      custom.map((sample) => `${sample.line}:${sample.metric}`),
    );
    parsed.samples = [
      ...parsed.samples.filter(
        (sample) => !claimed.has(`${sample.line}:${sample.metric}`),
      ),
      ...custom,
    ].sort((a, b) => a.line - b.line);
    parsed.unknownUnitSamples = parsed.samples.filter(
      (sample) => sample.unit === "unknown",
    ).length;
    parsed.recognized = true;
    parsed.formats.push("custom");
  }
  const series = new Map<string, MemoryObservation[]>();
  const tasks = new Map<string, MemoryTelemetrySample[]>();
  const paired = new Map<number, { free?: number; largest?: number }>();
  for (const sample of parsed.samples) {
    if (sample.task) {
      const values = tasks.get(sample.task) ?? [];
      values.push(sample);
      tasks.set(sample.task, values);
      if (tasks.size > 256)
        throw new PlatformIOError(
          "Telemetry exceeds 256 tasks.",
          "MEMORY_TELEMETRY_LIMIT",
        );
      continue;
    }
    if (sample.unit !== "bytes") continue;
    const values = series.get(sample.metric) ?? [];
    values.push({
      value: sample.value,
      ...(settings.elapsedSeconds
        ? { elapsedSeconds: settings.elapsedSeconds[sample.line] }
        : {}),
    });
    series.set(sample.metric, values);
    if (series.size > 256)
      throw new PlatformIOError(
        "Telemetry exceeds 256 metrics.",
        "MEMORY_TELEMETRY_LIMIT",
      );
    const pair = paired.get(sample.line) ?? {};
    if (sample.metric === "free_heap") pair.free = sample.value;
    if (sample.metric === "largest_free_block") pair.largest = sample.value;
    paired.set(sample.line, pair);
  }
  const metrics = Object.fromEntries(
    [...series].map(([metric, values]) => [
      metric,
      memoryMetricStatistics(metric, values),
    ]),
  );
  const stacks = [...tasks]
    .map(([task, values]) => {
      const known = values.filter((value) => value.unit === "bytes");
      const minimum = known.length
        ? Math.min(...known.map((value) => value.value))
        : null;
      return {
        task,
        samples: values.length,
        knownByteSamples: known.length,
        unknownUnitSamples: values.length - known.length,
        stackFreeBytes: minimum,
        warning: minimum === null ? null : minimum < settings.stackWarnBytes,
        lastBytes:
          values[values.length - 1].unit === "bytes"
            ? values[values.length - 1].value
            : null,
      };
    })
    .sort(
      (a, b) => (a.stackFreeBytes ?? Infinity) - (b.stackFreeBytes ?? Infinity),
    );
  const lastPair = [...paired]
    .filter(([, pair]) => pair.free !== undefined && pair.largest !== undefined)
    .at(-1);
  const fragmentation = lastPair
    ? {
        line: lastPair[0],
        ...memoryFragmentation(lastPair[1].free!, lastPair[1].largest!),
      }
    : null;
  return {
    recognized: parsed.recognized,
    formats: parsed.formats,
    sampleCount: parsed.samples.length,
    metrics,
    stacks,
    fragmentation,
    samples: parsed.samples.slice(-200),
    samplesTruncated: parsed.samples.length > 200,
    unknownUnitSamples: parsed.unknownUnitSamples,
    lineCount: lines.length,
    summary: parsed.recognized
      ? `${parsed.samples.length} memory observations in ${lines.length} lines; trends describe this sample window and do not confirm a leak.`
      : `No recognized memory telemetry in ${lines.length} lines. Add heap or stack instrumentation with explicit units.`,
  };
}

/** Analyze custom integer byte metrics using a bounded worker and the same report aggregation. */
export async function analyzeMemoryTelemetryPattern(
  lines: readonly string[],
  pattern: string,
  options: MemoryReportOptions = {},
) {
  // Validate all built-in bounds and options before creating a regex worker.
  analyzeMemoryTelemetry(lines, options);
  const captures = await extractBoundedCaptures(lines, pattern, {
    pythonNamedGroups: true,
  });
  const samples = captures.map((capture) => {
    if (!/^\d+$/.test(capture.value))
      throw new PlatformIOError(
        "Custom telemetry requires nonnegative integer byte values.",
        "MEMORY_VALUE_INVALID",
      );
    const value = Number(capture.value);
    if (!Number.isSafeInteger(value))
      throw new PlatformIOError(
        "Custom telemetry exceeds integer bounds.",
        "MEMORY_VALUE_INVALID",
      );
    const metric =
      (capture.name ?? "custom")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "custom";
    return { line: capture.line, metric, value, unit: "bytes" as const };
  });
  return analyzeParsedTelemetry(lines, options, samples);
}
