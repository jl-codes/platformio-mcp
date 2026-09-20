/** Current units, actual sample spans and reference histogram behavior remain explicit. */
import { expect, it } from "vitest";
import { analyzePowerObservations } from "../src/core/power/power-analysis.js";
const options = { provenance: "external_meter" as const };
it("computes charge and energy from the actual observed span", () => {
  const result = analyzePowerObservations(
    [
      { currentMa: 10, elapsedSeconds: 2 },
      { currentMa: 10, elapsedSeconds: 3602 },
    ],
    { ...options, voltageMv: 3300, buckets: 2 },
  );
  expect(result).toMatchObject({
    average_ma: 10,
    duration_s: 3600,
    charge_uah: 10000,
    energy_mwh: 33,
    battery_1000mah_hours: 100,
    threshold_source: "auto_median",
    sleep_fraction: 1,
    active_avg_ma: null,
  });
  expect(result.timeline).toEqual([
    { t_s: 2, avg_ma: 10 },
    { t_s: 1802, avg_ma: 10 },
  ]);
});
it("identifies separated sleep/active modes and preserves empty time buckets", () => {
  const samples = [1, 1, 1, 1, 100, 100].map((currentMa, index) => ({
    currentMa,
    elapsedSeconds: index < 4 ? 0 : 10,
  }));
  const result = analyzePowerObservations(samples, { ...options, buckets: 3 });
  expect(result).toMatchObject({
    threshold_source: "auto_bimodal",
    sleep_fraction: 0.6667,
    sleep_avg_ma: 1,
    active_avg_ma: 100,
    energy_mwh: null,
  });
  expect(result.timeline[1].avg_ma).toBeNull();
});
it("does not invent duration, energy voltage or battery life for a single zero sample", () => {
  const result = analyzePowerObservations(
    [{ currentMa: 0, elapsedSeconds: 12 }],
    { provenance: "firmware_estimate", buckets: 0 },
  );
  expect(result).toMatchObject({
    duration_s: 0,
    charge_uah: 0,
    energy_mwh: null,
    battery_1000mah_hours: null,
    timeline: [],
    provenance: "firmware_estimate",
  });
});
it("uses nearest-even percentile index and caller threshold", () => {
  const samples = Array.from({ length: 31 }, (_, index) => ({
    currentMa: index,
    elapsedSeconds: index,
  }));
  expect(
    analyzePowerObservations(samples, { ...options, sleepThresholdMa: 5 }),
  ).toMatchObject({
    p95_ma: 28,
    threshold_ma: 5,
    threshold_source: "argument",
  });
});
it("keeps negative current but does not predict battery life from net charging", () => {
  expect(
    analyzePowerObservations(
      [
        { currentMa: -1, elapsedSeconds: 0 },
        { currentMa: -1, elapsedSeconds: 3600 },
      ],
      options,
    ),
  ).toMatchObject({ charge_uah: -1000, battery_1000mah_hours: null });
});
it("rejects empty, nonfinite and backwards observations", () => {
  for (const input of [
    [],
    [{ currentMa: NaN, elapsedSeconds: 0 }],
    [
      { currentMa: 1, elapsedSeconds: 2 },
      { currentMa: 1, elapsedSeconds: 1 },
    ],
  ])
    expect(() => analyzePowerObservations(input, options)).toThrow();
});
