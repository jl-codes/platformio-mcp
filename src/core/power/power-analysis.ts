/** Bounded current statistics and reference-compatible power estimates with explicit timing/provenance. */
import { z } from "zod";
import { PlatformIOError } from "../../utils/errors.js";

const observationSchema = z
  .object({
    currentMa: z.number().finite().min(-1e9).max(1e9),
    elapsedSeconds: z.number().finite().min(0).max(86400),
  })
  .strict();
/** Collectors supply measured monotonic timestamps, never timestamps invented from requested duration. */
export type PowerObservation = z.infer<typeof observationSchema>;
const optionsSchema = z
  .object({
    voltageMv: z.number().finite().positive().max(1e9).nullable().default(null),
    buckets: z.number().int().min(0).max(1000).default(20),
    sleepThresholdMa: z.number().finite().min(-1e9).max(1e9).optional(),
    provenance: z.enum([
      "firmware_estimate",
      "external_meter",
      "unspecified_serial",
    ]),
  })
  .strict();

function rounded(value: number, digits: number) {
  return Number(value.toFixed(digits));
}
function average(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value / values.length, 0);
}
// Match Python's nearest-index percentile, including ties-to-even index rounding.
function nearestEven(value: number) {
  const floor = Math.floor(value),
    fraction = value - floor;
  return fraction === 0.5 ? floor + (floor % 2) : Math.round(value);
}
function threshold(values: readonly number[], sorted: readonly number[]) {
  const count = sorted.length,
    low = sorted[0],
    high = sorted[count - 1];
  const median =
    count % 2
      ? sorted[(count - 1) / 2]
      : (sorted[count / 2 - 1] + sorted[count / 2]) / 2;
  const fallback = { value: median, source: "auto_median" as const };
  if (high <= low || count < 4) return fallback;
  const width = (high - low) / 50;
  const bins = Array<number>(50).fill(0);
  for (const value of values)
    bins[Math.min(Math.floor((value - low) / width), 49)]++;
  const modes = bins
    .map((size, index) => ({ size, index }))
    .filter(({ size, index }) => {
      const left = bins[index - 1] ?? -1,
        right = bins[index + 1] ?? -1;
      return (
        size > 0 &&
        size >= left &&
        size >= right &&
        (size > left || size > right)
      );
    })
    .sort((a, b) => b.size - a.size || b.index - a.index);
  if (modes.length < 2) return fallback;
  const first = Math.min(modes[0].index, modes[1].index),
    second = Math.max(modes[0].index, modes[1].index);
  if (second - first < 3) return fallback;
  const valley = Math.min(...bins.slice(first + 1, second));
  const lowCenter = low + (first + 0.5) * width,
    highCenter = low + (second + 0.5) * width;
  if (
    valley > Math.min(modes[0].size, modes[1].size) / 2 ||
    (lowCenter > 0 && highCenter < 2 * lowCenter)
  )
    return fallback;
  return {
    value: (lowCenter + highCenter) / 2,
    source: "auto_bimodal" as const,
  };
}

/** Analyze a real observation span; charge/energy and battery life remain sample-mean estimates. */
export function analyzePowerObservations(
  input: unknown,
  options: z.input<typeof optionsSchema>,
) {
  const parsed = z.array(observationSchema).min(1).max(120000).safeParse(input);
  const settings = optionsSchema.safeParse(options);
  if (!parsed.success || !settings.success)
    throw new PlatformIOError(
      "Invalid power observations or analysis options.",
      "POWER_ANALYSIS_INVALID",
    );
  const samples = parsed.data,
    args = settings.data;
  for (let i = 1; i < samples.length; i++)
    if (samples[i].elapsedSeconds < samples[i - 1].elapsedSeconds)
      throw new PlatformIOError(
        "Power observation timestamps must be monotonic.",
        "POWER_TIMING_INVALID",
      );
  const values = samples.map((sample) => sample.currentMa);
  const ordered = [...values].sort((a, b) => a - b);
  const mean = average(values),
    first = samples[0].elapsedSeconds;
  const duration = samples.at(-1)!.elapsedSeconds - first;
  const selected =
    args.sleepThresholdMa === undefined
      ? threshold(values, ordered)
      : { value: args.sleepThresholdMa, source: "argument" as const };
  const sleeping = values.filter((value) => value <= selected.value),
    active = values.filter((value) => value > selected.value);
  const buckets = Array.from({ length: args.buckets }, () => ({
    sum: 0,
    count: 0,
  }));
  if (args.buckets)
    for (const sample of samples) {
      const index =
        duration > 0
          ? Math.min(
              Math.floor(
                ((sample.elapsedSeconds - first) / duration) * args.buckets,
              ),
              args.buckets - 1,
            )
          : 0;
      buckets[index].sum += sample.currentMa;
      buckets[index].count++;
    }
  const hours = duration / 3600;
  const estimate = mean > 0 ? 1000 / mean : null;
  return {
    average_ma: rounded(mean, 4),
    min_ma: rounded(ordered[0], 4),
    max_ma: rounded(ordered.at(-1)!, 4),
    p95_ma: rounded(ordered[nearestEven(0.95 * (values.length - 1))], 4),
    sample_count: values.length,
    duration_s: rounded(duration, 3),
    voltage_mv: args.voltageMv,
    charge_uah: rounded(mean * hours * 1000, 3),
    energy_mwh:
      args.voltageMv === null
        ? null
        : rounded(((mean * args.voltageMv) / 1000) * hours, 4),
    threshold_ma: rounded(selected.value, 4),
    threshold_source: selected.source,
    sleep_fraction: rounded(sleeping.length / values.length, 4),
    sleep_avg_ma: sleeping.length ? rounded(average(sleeping), 4) : null,
    active_avg_ma: active.length ? rounded(average(active), 4) : null,
    timeline: buckets.map((bucket, index) => ({
      t_s: rounded(first + (index * duration) / args.buckets, 3),
      avg_ma: bucket.count ? rounded(bucket.sum / bucket.count, 4) : null,
    })),
    battery_1000mah_hours:
      estimate !== null && Number.isFinite(estimate)
        ? rounded(estimate, 1)
        : null,
    provenance: args.provenance,
    duration_basis: "first_to_last_observation" as const,
    energy_method: "sample_mean_estimate" as const,
    sleep_fraction_basis: "sample_count" as const,
    battery_estimate_basis:
      "ideal_capacity_at_observed_average_excludes_losses" as const,
  };
}
