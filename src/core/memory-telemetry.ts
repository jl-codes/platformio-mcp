/** Bounded byte-valued memory statistics with explicit observation windows and heuristic trends. */
import { z } from "zod";
const sampleSchema = z
  .object({
    value: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    elapsedSeconds: z.number().finite().nonnegative().optional(),
  })
  .strict();
/** A byte-valued observation; callers must convert known word units before analysis. */
export type MemoryObservation = z.infer<typeof sampleSchema>;
const freeMetrics = new Set([
  "free_heap",
  "min_free_heap",
  "largest_free_block",
  "psram_free",
]);
/** Fit sample order, reporting time rates only when actual observation timestamps support them. */
export function memoryMetricStatistics(metric: string, input: unknown) {
  const samples = z.array(sampleSchema).min(1).max(10000).parse(input);
  const n = samples.length;
  const values = samples.map((sample) => sample.value);
  const mean = values.reduce((sum, value) => sum + value / n, 0);
  const meanIndex = (n - 1) / 2;
  let numerator = 0,
    denominator = 0;
  for (let index = 0; index < n; index++) {
    numerator += (index - meanIndex) * (values[index] - mean);
    denominator += (index - meanIndex) ** 2;
  }
  const slope = denominator ? numerator / denominator : 0;
  const change = slope * (n - 1);
  const threshold = Math.max(256, mean * 0.01);
  const verdict =
    n < 3
      ? "insufficient_samples"
      : Math.abs(change) > threshold
        ? change > 0
          ? "growing"
          : "shrinking"
        : "stable";
  const times = samples.map((sample) => sample.elapsedSeconds);
  const timed = times.every(
    (time, index) =>
      time !== undefined && (index === 0 || time > times[index - 1]!),
  );
  let perSecond: number | null = null;
  if (timed && n >= 2) {
    const origin = times[0]!;
    const relative = times.map((time) => time! - origin);
    const meanTime = relative.reduce((sum, time) => sum + time / n, 0);
    let num = 0,
      den = 0;
    for (let index = 0; index < n; index++) {
      num += (relative[index] - meanTime) * (values[index] - mean);
      den += (relative[index] - meanTime) ** 2;
    }
    if (den > 0 && Number.isFinite(num / den)) perSecond = num / den;
  }
  return {
    metric,
    unit: "bytes" as const,
    samples: n,
    first: values[0],
    last: values[n - 1],
    min: Math.min(...values),
    max: Math.max(...values),
    fittedChange: change,
    bytesPerSample: slope,
    bytesPerSecond: perSecond,
    verdict,
    leakSuspected:
      (verdict === "shrinking" && freeMetrics.has(metric)) ||
      (verdict === "growing" && metric === "allocated"),
    evidence: "window_trend_only" as const,
  };
}
/** Only compare paired observations; independently sampled last values do not establish fragmentation. */
export function memoryFragmentation(
  freeBytes: number,
  largestBlockBytes: number,
) {
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(freeBytes);
  z.number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .parse(largestBlockBytes);
  if (freeBytes === 0 || largestBlockBytes > freeBytes)
    return {
      available: false as const,
      reason: "inconsistent_or_zero_free_heap",
    };
  const ratio = largestBlockBytes / freeBytes;
  return {
    available: true as const,
    ratio,
    fragmented: ratio < 0.5,
    freeHeap: freeBytes,
    largestFreeBlock: largestBlockBytes,
    evidence: "allocation_capacity_hint" as const,
  };
}
