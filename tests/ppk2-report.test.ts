/** Meter reports integrate full sample windows and preserve partial/error qualifiers. */
import { expect, it } from "vitest";
import { Ppk2Protocol } from "../src/core/power/ppk2-protocol.js";
import { projectPpk2PowerReport } from "../src/core/power/ppk2-report.js";
const request = {
  port: "FAKE",
  mode: "ampere" as const,
  voltageMv: 3300,
  currentLimitMa: 600,
  seconds: 10,
};
function fixture(samples = [100, 100], partial = 0, outcome = "complete") {
  const protocol = new Ppk2Protocol(request);
  const emit = (value: unknown) =>
    protocol.accept(Buffer.from(JSON.stringify(value) + "\n"));
  emit({
    event: "started",
    mode: "ampere",
    sampleRateHz: 100000,
    windowSamples: 1000,
    currentLimitKind: "software_trip",
  });
  if (samples.length) emit({ event: "samples", currentMa: samples });
  emit({
    event: "finished",
    outcome,
    sampleCount: samples.length * 1000 + partial,
    emittedWindows: samples.length,
    unreportedWindows: 0,
    partialWindowSamples: partial,
    durationSeconds: 0.8,
    partialRawBytes: 0,
    deviceTouched: true,
    outputOffWritten: false,
    outputOffPhysicallyVerified: false,
    powerMayBeOn: false,
    measurementStopped: true,
    serialClosed: true,
  });
  protocol.end();
  return protocol.snapshot();
}
it("integrates the full windows instead of the observation-center span or requested duration", () => {
  expect(projectPpk2PowerReport(fixture(), request)).toMatchObject({
    ok: true,
    sample_count: 2,
    raw_sample_count: 2000,
    average_ma: 100,
    seconds: 10,
    duration_s: 0.02,
    collection_duration_s: 0.8,
    charge_uah: 0.556,
    energy_mwh: 0.0018,
    statistics_basis: "10ms_window_means",
    output_off_physically_verified: false,
    voltage_physically_measured: false,
  });
});
it("retains useful statistics but does not hide omitted partial windows or current trips", () => {
  expect(projectPpk2PowerReport(fixture([100], 30), request)).toMatchObject({
    ok: false,
    partial_window_samples: 30,
    average_ma: 100,
    error: "PPK2_INCOMPLETE_SAMPLES",
  });
  expect(
    projectPpk2PowerReport(fixture([100], 0, "PPK2_CURRENT_TRIP"), request),
  ).toMatchObject({
    ok: false,
    collection_complete: false,
    error: "PPK2_CURRENT_TRIP",
  });
});
it("does not invent zero-current energy from absent samples", () => {
  expect(projectPpk2PowerReport(fixture([]), request)).toMatchObject({
    ok: false,
    sample_count: 0,
    charge_uah: null,
    energy_mwh: null,
  });
});
it("refuses output before terminal cleanup validation", () => {
  expect(() =>
    projectPpk2PowerReport({ ...fixture(), ended: false }, request),
  ).toThrow(/terminal cleanup/);
  expect(() =>
    projectPpk2PowerReport({ ...fixture(), cleanupReported: false }, request),
  ).toThrow(/terminal cleanup/);
});
