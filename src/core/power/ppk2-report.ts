/** Convert validated PPK2 windows into reference statistics without substituting requested or wall-clock duration for sample time. */
import type { z } from "zod";
import { PlatformIOError } from "../../utils/errors.js";
import { analyzePowerObservations } from "./power-analysis.js";
import { Ppk2RequestSchema } from "./ppk2-protocol.js";
import type { Ppk2Process } from "./ppk2-process.js";

/** Project only a successfully closed owned process report; meter shutdown acknowledgment is not physical verification. */
export function projectPpk2PowerReport(
  report: Awaited<ReturnType<Ppk2Process["collect"]>>,
  input: z.input<typeof Ppk2RequestSchema>,
  analysisOptions: { buckets?: number; sleepThresholdMa?: number } = {},
) {
  const parsed = Ppk2RequestSchema.safeParse(input);
  if (
    !parsed.success ||
    !report.ended ||
    report.failed ||
    !report.cleanupReported ||
    !report.finished
  )
    throw new PlatformIOError(
      "PPK2 report lacks validated terminal cleanup.",
      "PPK2_REPORT_INVALID",
    );
  const request = parsed.data,
    finish = report.finished;
  // The fixed bridge averages exactly 1000 samples at the meter's declared 100 kHz sample clock.
  const windowSeconds = 1000 / 100000;
  const samples = report.currentMa;
  const statistics = samples.length
    ? analyzePowerObservations(
        samples.map((currentMa, index) => ({
          currentMa,
          elapsedSeconds: index * windowSeconds,
        })),
        {
          ...analysisOptions,
          voltageMv: request.voltageMv,
          provenance: "external_meter",
        },
      )
    : null;
  const duration = samples.length * windowSeconds;
  const charge = samples.reduce(
    (total, currentMa) => total + (currentMa * windowSeconds) / 3.6,
    0,
  );
  const complete =
    finish.outcome === "complete" &&
    samples.length > 0 &&
    finish.unreportedWindows === 0 &&
    finish.partialWindowSamples === 0 &&
    finish.partialRawBytes === 0;
  return {
    ...statistics,
    ok: complete,
    source: "ppk2" as const,
    mode: request.mode,
    port: request.port,
    seconds: request.seconds,
    sample_count: samples.length,
    raw_sample_count: finish.sampleCount,
    unparsed_lines: 0,
    duration_s: Number(duration.toFixed(3)),
    collection_duration_s: finish.durationSeconds,
    duration_basis: "complete_windows_at_meter_sample_rate" as const,
    statistics_basis: "10ms_window_means" as const,
    energy_method: "integrated_complete_window_means" as const,
    voltage_source:
      request.mode === "source"
        ? "requested_source_setpoint"
        : "operator_supplied_calibration",
    voltage_physically_measured: false,
    voltage_mv: request.voltageMv,
    charge_uah: samples.length ? Number(charge.toFixed(3)) : null,
    energy_mwh: samples.length
      ? Number(((charge * request.voltageMv) / 1000000).toFixed(4))
      : null,
    provenance: "external_meter" as const,
    current_limit_ma: request.currentLimitMa,
    current_limit_kind: "software_trip" as const,
    collection_complete: complete,
    partial_window_samples: finish.partialWindowSamples,
    unreported_windows: finish.unreportedWindows,
    partial_raw_bytes: finish.partialRawBytes,
    cleanup_pending: false,
    output_off_written: finish.outputOffWritten,
    output_off_physically_verified: false,
    outcome: finish.outcome,
    summary: complete
      ? `${samples.length} complete PPK2 current windows collected.`
      : "PPK2 collection is incomplete; statistics cover only returned complete windows.",
    ...(complete
      ? {}
      : {
          error:
            finish.outcome === "complete"
              ? samples.length
                ? "PPK2_INCOMPLETE_SAMPLES"
                : "no_samples"
              : finish.outcome,
        }),
  };
}
