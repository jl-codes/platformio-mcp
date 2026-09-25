/** Bounded memory telemetry collection from an already-owned, authorized serial session. */
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type {
  SerialSessionManager,
  SerialSessionOwner,
} from "./session-manager.js";
import type { SerialBufferRead } from "./session-buffer.js";
import {
  analyzeMemoryTelemetry,
  analyzeMemoryTelemetryPattern,
  type MemoryReportOptions,
} from "../memory-report.js";

/** Shared validation before either existing-session collection or one-shot port startup. */
export const MemoryCaptureSchema = z
  .object({
    seconds: z.number().finite().min(0).max(300).default(15),
    maxLines: z.number().int().min(1).max(10000).default(5000),
    cursor: z.number().int().nonnegative().default(0),
    pattern: z.string().max(4096).optional(),
    stackUnit: z.enum(["bytes", "words"]).optional(),
    stackWordBytes: z.number().int().min(1).max(16).optional(),
    stackWarnBytes: z
      .number()
      .int()
      .nonnegative()
      .max(1024 * 1024 * 1024)
      .optional(),
  })
  .strict();

/** Collect completed lines only; every page and the final result pass through session read authorization. */
export async function captureSessionMemory(
  manager: Pick<SerialSessionManager, "read">,
  owner: SerialSessionOwner,
  sessionId: string,
  input: {
    seconds?: number;
    maxLines?: number;
    cursor?: number;
    pattern?: string;
    stackUnit?: "bytes" | "words";
    stackWordBytes?: number;
    stackWarnBytes?: number;
  } = {},
  signal?: AbortSignal,
) {
  const args = MemoryCaptureSchema.parse(input);
  const started = performance.now();
  const deadline = started + args.seconds * 1000;
  const lines: string[] = [];
  let bytes = 0,
    cursor = args.cursor,
    droppedLines = 0,
    truncatedBytes = 0;
  let redactionApplied = false,
    redactionOutputMayBeTruncated = false;
  let last: SerialBufferRead;
  let limitReached = false;
  do {
    const remaining = Math.max(0, deadline - performance.now());
    last = await manager.read(owner, sessionId, {
      cursor,
      maxLines: Math.min(500, args.maxLines - lines.length),
      maxBytes: Math.max(65536, 1024 * 1024 - bytes),
      timeoutMs: Math.min(1000, Math.ceil(remaining)),
      signal,
    });
    redactionApplied ||= last.redactionApplied;
    redactionOutputMayBeTruncated ||= last.redactionOutputMayBeTruncated;
    droppedLines += last.droppedLines;
    let accepted = 0;
    for (let index = 0; index < last.lines.length; index++) {
      const text = last.lines[index];
      const size = Buffer.byteLength(text);
      if (bytes + size > 1024 * 1024) {
        limitReached = true;
        break;
      }
      lines.push(text);
      accepted++;
      bytes += size;
      truncatedBytes += last.lineTruncatedBytes[index] ?? 0;
    }
    cursor = last.cursor - last.lines.length + accepted;
    if (lines.length >= args.maxLines || bytes >= 1024 * 1024)
      limitReached = true;
    if (
      limitReached ||
      last.readStatus === "cancelled" ||
      (last.state !== "open" && !last.moreAvailable) ||
      (performance.now() >= deadline && !last.moreAvailable)
    )
      break;
    // Partial text makes read return immediately; yield so incoming bytes and cancellation can progress.
    if (last.lines.length === 0) await delay(1);
  } while (true);
  const options: MemoryReportOptions = {
    stackUnit: args.stackUnit,
    stackWordBytes: args.stackWordBytes,
    stackWarnBytes: args.stackWarnBytes,
  };
  const report =
    args.pattern === undefined
      ? analyzeMemoryTelemetry(lines, options)
      : await analyzeMemoryTelemetryPattern(lines, args.pattern, options);
  // Authorization may change while the analysis worker runs; do not disclose its result without a fresh check.
  const final = await manager.read(owner, sessionId, {
    cursor,
    maxLines: 1,
    maxBytes: 65536,
    timeoutMs: 0,
  });
  const portError = final.error ?? last.error ?? null;
  const cancelled = last.readStatus === "cancelled" || signal?.aborted === true;
  const terminalError =
    final.state === "error" || final.state === "disconnected";
  return {
    ...report,
    ok: !portError && !cancelled && !terminalError,
    sessionId,
    cursor,
    durationSeconds: (performance.now() - started) / 1000,
    portError,
    state: final.state,
    cancelled,
    limitReached,
    droppedLines,
    truncatedBytes,
    partialLineOmitted: !!last.partial,
    redactionApplied,
    redactionOutputMayBeTruncated,
    collectionComplete:
      !limitReached &&
      droppedLines === 0 &&
      truncatedBytes === 0 &&
      !portError &&
      !cancelled &&
      !terminalError &&
      !redactionOutputMayBeTruncated,
  };
}
