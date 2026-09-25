/** Collect fresh boot evidence from an owned serial session with bounded regex and loss-aware verdicts. */
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { matchBoundedLines } from "../bounded-pattern.js";
import { evaluateRuntimeAssertions } from "../runtime-assertions.js";
import type {
  SerialSessionManager,
  SerialSessionOwner,
} from "./session-manager.js";

/** Verification limits form part of the scoped read approval, including post-match observation. */
export const VerificationCaptureSchema = z
  .object({
    expect: z
      .string()
      .max(4096)
      .default("setup done|ready|started|Booting|loop"),
    failOn: z
      .string()
      .max(4096)
      .default(
        "Guru Meditation|panic|assert failed|HardFault|Hard Fault|BusFault|UsageFault|MemManage|stack overflow|watchdog|Brownout|CORRUPT HEAP|Backtrace:",
      ),
    timeoutSeconds: z.number().finite().min(0).max(300).default(30),
    settleSeconds: z.number().finite().min(0).max(30).default(1.5),
    stabilityWindowSeconds: z.number().finite().min(0).max(60).default(10),
    maxLines: z.number().int().min(1).max(10000).default(500),
  })
  .strict();

/** Validate expressions before upload/open; the worker, never the server event loop, compiles caller regex. */
export async function validateVerificationCapture(
  input: z.input<typeof VerificationCaptureSchema>,
) {
  const args = VerificationCaptureSchema.parse(input);
  await matchBoundedLines([], args.expect, {
    mode: "regex",
    pythonNamedGroups: true,
  });
  if (args.failOn)
    await matchBoundedLines([], args.failOn, {
      mode: "regex",
      pythonNamedGroups: true,
    });
  return args;
}

/** Read only the supplied owned session; never inspect a shared log or infer success from missing output. */
export async function captureSessionVerification(
  manager: Pick<SerialSessionManager, "read">,
  owner: SerialSessionOwner,
  sessionId: string,
  input: z.input<typeof VerificationCaptureSchema> = {},
  signal?: AbortSignal,
) {
  const args = await validateVerificationCapture(input);
  const started = performance.now();
  const deadline = started + args.timeoutSeconds * 1000;
  const lines: string[] = [];
  let cursor = 0,
    bytes = 0,
    lineCount = 0,
    droppedLines = 0,
    truncatedBytes = 0;
  let lastOutput = started,
    failureAt: number | undefined;
  let matchedLine: string | null = null,
    failureLine: string | null = null;
  let lost = false,
    cancelled = false,
    closed = false;
  let portError: string | null = null;
  let redactionApplied = false,
    redactionOutputMayBeTruncated = false;
  let resetCount = 0;
  const runtimeFailures = new Set<string>();
  let verdict: "pass" | "fail" | "timeout" | "inconclusive" = "timeout";
  do {
    const end =
      failureAt === undefined
        ? deadline
        : failureAt + args.settleSeconds * 1000;
    const read = await manager.read(owner, sessionId, {
      cursor,
      maxLines: 500,
      maxBytes: 1024 * 1024,
      timeoutMs: Math.min(
        1000,
        Math.max(0, Math.ceil(end - performance.now())),
      ),
      signal,
    });
    cursor = read.cursor;
    droppedLines += read.droppedLines;
    truncatedBytes += read.lineTruncatedBytes.reduce(
      (sum, count) => sum + count,
      0,
    );
    lost ||=
      read.droppedLines > 0 ||
      read.lineTruncatedBytes.some((count) => count > 0) ||
      read.partialTruncatedBytes > 0;
    redactionApplied ||= read.redactionApplied;
    redactionOutputMayBeTruncated ||= read.redactionOutputMayBeTruncated;
    lost ||= read.redactionOutputMayBeTruncated;
    cancelled ||= read.readStatus === "cancelled" || !!signal?.aborted;
    closed = read.state !== "open";
    portError = read.error ?? portError;
    if (read.lines.length || read.partial) lastOutput = performance.now();
    const passes = await matchBoundedLines(read.lines, args.expect, {
      mode: "regex",
      pythonNamedGroups: true,
    });
    const failures = args.failOn
      ? await matchBoundedLines(read.lines, args.failOn, {
          mode: "regex",
          pythonNamedGroups: true,
        })
      : [];
    if (matchedLine === null && passes.length)
      matchedLine = read.lines[passes[0]];
    if (failureLine === null && failures.length)
      failureLine = read.lines[failures[0]];
    for (const line of read.lines) {
      lineCount++;
      lines.push(line);
      bytes += Buffer.byteLength(line);
      while (lines.length > args.maxLines || bytes > 1024 * 1024)
        bytes -= Buffer.byteLength(lines.shift()!);
    }
    // Keep the legacy built-in crash checks in addition to the reference's configurable regex.
    const assertions = evaluateRuntimeAssertions({
      serialOutput: read.lines.join("\n"),
      stabilityWindowSeconds: 0,
    });
    for (const name of assertions.runtimeFailures)
      if (name !== "NoSerialOutput") runtimeFailures.add(name);
    resetCount += (read.lines.join("\n").match(/rst:/gi) ?? []).length;
    if (resetCount >= 2) runtimeFailures.add("BootLoop");
    if (failureLine !== null || runtimeFailures.size > 0) {
      failureAt ??= performance.now();
      verdict = "fail";
    }
    const now = performance.now();
    if (failureAt !== undefined && now >= failureAt + args.settleSeconds * 1000)
      break;
    if (
      failureAt === undefined &&
      matchedLine !== null &&
      (now - lastOutput) / 1000 >= args.stabilityWindowSeconds &&
      !read.moreAvailable
    ) {
      verdict =
        lost || cancelled || closed || portError ? "inconclusive" : "pass";
      break;
    }
    if (
      cancelled ||
      (closed && !read.moreAvailable) ||
      (failureAt === undefined && now >= deadline)
    )
      break;
    // A partial line can cause immediate reads; yield while still checking the absolute deadline.
    if (!read.lines.length) await delay(1);
  } while (true);
  // Final authorization/revision check prevents disclosure after revocation during pattern evaluation.
  await manager.read(owner, sessionId, {
    cursor,
    maxLines: 1,
    timeoutMs: 0,
    signal,
  });
  if (verdict !== "fail" && (lost || cancelled || closed || portError))
    verdict = "inconclusive";
  return {
    ok: verdict === "pass",
    verdict,
    matched_line: failureLine ?? matchedLine,
    expect: args.expect,
    fail_on: args.failOn,
    lines,
    line_count: lineCount,
    verify_s: (performance.now() - started) / 1000,
    port_error: portError,
    dropped_lines: droppedLines,
    truncated_bytes: truncatedBytes,
    evidence_complete: !lost && !cancelled && !closed && !portError,
    retained_lines: lines.length,
    runtime_failures: [...runtimeFailures],
    redactionApplied,
    redactionOutputMayBeTruncated,
  };
}
