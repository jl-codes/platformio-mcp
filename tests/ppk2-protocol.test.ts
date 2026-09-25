/** Reject forged-looking or incomplete PPK2 streams before any cleanup claim. */
import { expect, it } from "vitest";
import { Ppk2Protocol } from "../src/core/power/ppk2-protocol.js";
const request = {
  port: "FAKE",
  mode: "source",
  voltageMv: 3300,
  currentLimitMa: 50,
  seconds: 1,
};
const started = {
  event: "started",
  mode: "source",
  sampleRateHz: 100000,
  windowSamples: 1000,
  currentLimitKind: "software_trip",
};
const finished = {
  event: "finished",
  outcome: "complete",
  sampleCount: 1000,
  partialWindowSamples: 0,
  emittedWindows: 1,
  unreportedWindows: 0,
  durationSeconds: 0.01,
  partialRawBytes: 0,
  deviceTouched: true,
  outputOffWritten: true,
  outputOffPhysicallyVerified: false,
  powerMayBeOn: false,
  measurementStopped: true,
  serialClosed: true,
};
function send(protocol: Ppk2Protocol, value: unknown) {
  protocol.accept(Buffer.from(JSON.stringify(value) + "\n"));
}
function sample(protocol: Ppk2Protocol) {
  send(protocol, started);
  send(protocol, { event: "samples", currentMa: [1] });
}
it("handles fragmented records and distinguishes reported cleanup from process proof", () => {
  const p = new Ppk2Protocol(request);
  const wire = Buffer.from(
    [started, { event: "samples", currentMa: [1] }, finished]
      .map((item) => JSON.stringify(item) + "\n")
      .join(""),
  );
  for (const byte of wire) p.accept(Buffer.from([byte]));
  expect(p.snapshot()).toMatchObject({
    terminal: true,
    ended: false,
    cleanupReported: true,
  });
  p.end();
  expect(p.snapshot()).toMatchObject({
    ended: true,
    currentMa: [1],
    finished: { outputOffPhysicallyVerified: false },
  });
});
it.each([
  { emittedWindows: 2 },
  { sampleCount: 1001 },
  { outputOffPhysicallyVerified: true },
  { powerMayBeOn: true },
  { unreportedWindows: 1, sampleCount: 2000 },
])("rejects inconsistent terminal output %j", (change) => {
  const p = new Ppk2Protocol(request);
  sample(p);
  expect(() => send(p, { ...finished, ...change })).toThrow();
  expect(p.snapshot().cleanupReported).toBe(false);
});
it("retains uncertainty when source-off or port closure fails", () => {
  const p = new Ppk2Protocol(request);
  sample(p);
  send(p, {
    ...finished,
    outcome: "PPK2_IO_FAILED",
    outputOffWritten: false,
    powerMayBeOn: true,
  });
  p.end();
  expect(p.snapshot().cleanupReported).toBe(false);
});
it("rejects wrong mode, oversized current and missing terminal", () => {
  expect(() =>
    send(new Ppk2Protocol(request), { ...started, mode: "ampere" }),
  ).toThrow();
  const p = new Ppk2Protocol(request);
  send(p, started);
  expect(() => send(p, { event: "samples", currentMa: [51] })).toThrow();
  const missing = new Ppk2Protocol(request);
  send(missing, started);
  expect(() => missing.end()).toThrow();
});
it("accepts unavailable before startup but rejects post-terminal records", () => {
  const p = new Ppk2Protocol(request);
  send(p, { event: "unavailable", code: "PPK2_API_MISSING" });
  expect(p.snapshot()).toMatchObject({
    started: false,
    unavailable: "PPK2_API_MISSING",
  });
  expect(() => send(p, started)).toThrow();
  expect(p.snapshot().cleanupReported).toBe(false);
});
it("rejects oversized input and sample-before-start records", () => {
  expect(() => new Ppk2Protocol({ ...request, currentLimitMa: 601 })).toThrow();
  expect(() =>
    new Ppk2Protocol(request).accept(Buffer.alloc(16385, 32)),
  ).toThrow();
  expect(() =>
    send(new Ppk2Protocol(request), { event: "samples", currentMa: [1] }),
  ).toThrow();
});
it("reports incompatible dependencies as an unopened terminal outcome", () => {
  const p = new Ppk2Protocol(request);
  send(p, { event: "unavailable", code: "PPK2_API_INCOMPATIBLE" });
  p.end();
  expect(p.snapshot()).toMatchObject({
    ended: true,
    started: false,
    cleanupReported: true,
    unavailable: "PPK2_API_INCOMPATIBLE",
    currentMa: [],
  });
});
