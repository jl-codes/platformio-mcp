/** Bounded power collection from an already-owned and policy-authorized serial session. */
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type {
  SerialSessionManager,
  SerialSessionOwner,
} from "./session-manager.js";
import type { SerialBufferRead } from "./session-buffer.js";
import {
  analyzePowerObservations,
  type PowerObservation,
} from "../power/power-analysis.js";
import { parsePowerLines } from "../power/power-parser.js";

/** Validate duration, output limits and interpretation before opening a meter port. */
export const PowerCaptureSchema = z
  .object({
    seconds: z.number().finite().positive().max(600).default(10),
    maxLines: z.number().int().min(1).max(10000).default(10000),
    cursor: z.number().int().nonnegative().default(0),
    pattern: z.string().max(4096).optional(),
    voltageMv: z.number().finite().positive().max(1e9).optional(),
    buckets: z.number().int().min(0).max(1000).default(20),
    sleepThresholdMa: z.number().finite().min(-1e9).max(1e9).optional(),
    provenance: z
      .enum(["firmware_estimate", "external_meter", "unspecified_serial"])
      .default("unspecified_serial"),
  })
  .strict();

/** Compile custom patterns in a bounded worker before a transient meter session opens. */
export async function validatePowerCapture(
  input: z.input<typeof PowerCaptureSchema> = {},
) {
  const args = PowerCaptureSchema.parse(input);
  await parsePowerLines([], args.pattern);
  return args;
}

/** Timestamp each observed batch, preserve loss accounting and reauthorize after parsing before disclosure. */
export async function captureSessionPower(
  manager: Pick<SerialSessionManager, "read">,
  owner: SerialSessionOwner,
  sessionId: string,
  input: z.input<typeof PowerCaptureSchema> = {},
  signal?: AbortSignal,
) {
  const args = await validatePowerCapture(input);
  const started = performance.now(),
    deadline = started + args.seconds * 1000;
  const samples: PowerObservation[] = [],
    volts: number[] = [];
  let cursor = args.cursor,
    bytes = 0,
    lineCount = 0,
    unparsed = 0,
    dropped = 0,
    truncated = 0;
  let limit = false,
    redacted = false,
    redactionClipped = false;
  let last: SerialBufferRead;
  do {
    last = await manager.read(owner, sessionId, {
      cursor,
      maxLines: Math.min(500, args.maxLines - lineCount),
      maxBytes: 65536,
      timeoutMs: Math.min(
        250,
        Math.max(0, Math.ceil(deadline - performance.now())),
      ),
      signal,
    });
    const elapsedSeconds = (performance.now() - started) / 1000;
    dropped += last.droppedLines;
    redacted ||= last.redactionApplied;
    redactionClipped ||= last.redactionOutputMayBeTruncated;
    const lines: string[] = [];
    for (let index = 0; index < last.lines.length; index++) {
      const size = Buffer.byteLength(last.lines[index]);
      if (bytes + size > 1024 * 1024) {
        limit = true;
        break;
      }
      lines.push(last.lines[index]);
      bytes += size;
      truncated += last.lineTruncatedBytes[index] ?? 0;
    }
    cursor = last.cursor - last.lines.length + lines.length;
    lineCount += lines.length;
    const parsed = await parsePowerLines(lines, args.pattern);
    unparsed += parsed.unparsedLines;
    for (const sample of parsed.samples) {
      samples.push({ currentMa: sample.currentMa, elapsedSeconds });
      if (sample.voltageMv !== null) volts.push(sample.voltageMv);
    }
    limit ||= lineCount >= args.maxLines || bytes >= 1024 * 1024;
    if (
      limit ||
      last.readStatus === "cancelled" ||
      signal?.aborted ||
      last.state !== "open" ||
      performance.now() >= deadline
    )
      break;
    if (!lines.length) await delay(1);
  } while (true);
  const final = await manager.read(owner, sessionId, {
    cursor,
    maxLines: 1,
    maxBytes: 65536,
    timeoutMs: 0,
  });
  const cancelled = last.readStatus === "cancelled" || signal?.aborted === true;
  const portError = final.error ?? last.error ?? null;
  const complete =
    !limit &&
    !cancelled &&
    !portError &&
    !dropped &&
    !truncated &&
    !redactionClipped &&
    last.state === "open" &&
    final.state === "open";
  const voltageMv =
    args.voltageMv ??
    (volts.length
      ? volts.reduce((sum, value) => sum + value / volts.length, 0)
      : null);
  const analysis = samples.length
    ? analyzePowerObservations(samples, {
        voltageMv,
        buckets: args.buckets,
        sleepThresholdMa: args.sleepThresholdMa,
        provenance: args.provenance,
      })
    : null;
  return {
    ok: complete && samples.length > 0,
    summary: samples.length
      ? `${samples.length} serial current observations collected; energy and battery life are sample-mean estimates.`
      : "No current readings captured; check meter output, baud and pattern.",
    analysis,
    sessionId,
    cursor,
    lineCount,
    unparsedLines: unparsed,
    collectionDurationSeconds: (performance.now() - started) / 1000,
    timingBasis: "host_read_observation" as const,
    voltageSource:
      args.voltageMv !== undefined
        ? ("argument" as const)
        : volts.length
          ? ("serial_mean" as const)
          : ("unknown" as const),
    state: final.state,
    portError,
    cancelled,
    limitReached: limit,
    droppedLines: dropped,
    truncatedBytes: truncated,
    partialLineOmitted: !!last.partial,
    redactionApplied: redacted,
    redactionOutputMayBeTruncated: redactionClipped,
    collectionComplete: complete,
  };
}
