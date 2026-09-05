/**
 * Serial Monitor Health Classification
 *
 * Provides:
 * - evaluateMonitorHealth: Classifies bounded, redacted serial evidence.
 * - compileBoundedPattern: Safely compiles opt-in regular expressions.
 */

import crypto from "node:crypto";
import { redactSecretsInText } from "./policy/redact.js";
import { PlatformIOError } from "../utils/errors.js";

const MAX_PATTERN_LENGTH = 128;
const MAX_EVIDENCE_BYTES = 8192;

/** Stable monitor health states used by interactive and scheduled runs. */
export type MonitorHealthStatus =
  | "healthy"
  | "degraded"
  | "failed"
  | "silent"
  | "disconnected"
  | "inconclusive";

/** Structured health result designed for change-aware automation. */
export interface MonitorHealthResult {
  status: MonitorHealthStatus;
  changed: boolean;
  recovered: boolean;
  cursor?: string;
  digest: string;
  matchedExpectations: string[];
  unmatchedExpectations: string[];
  matchedRejectedPatterns: string[];
  evidence: string;
  consecutiveFailures: number;
  recommendedAction: string;
  observedAt: string;
}

/**
 * Compiles a bounded pattern. Plain strings are matched literally; an `re:`
 * prefix opts into a restricted regular expression.
 *
 * @param pattern - Literal text or a restricted `re:` expression.
 * @returns Safe case-insensitive matcher.
 */
export function compileBoundedPattern(pattern: string): RegExp {
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) {
    throw new PlatformIOError(
      `Monitor patterns must be 1-${MAX_PATTERN_LENGTH} characters.`,
      "UNSAFE_PATTERN",
    );
  }
  if (!pattern.startsWith("re:")) {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu");
  }

  const source = pattern.slice(3);
  if (
    !source ||
    /\(\?[=!<]/u.test(source) ||
    /\\[1-9]/u.test(source) ||
    /(?:\*|\+|\{\d+(?:,\d*)?\})(?:\s*)(?:\*|\+|\{)/u.test(source)
  ) {
    throw new PlatformIOError(
      "The requested regular expression uses an unsafe construct.",
      "UNSAFE_PATTERN",
    );
  }

  try {
    return new RegExp(source, "iu");
  } catch {
    throw new PlatformIOError(
      "The requested monitor regular expression is invalid.",
      "UNSAFE_PATTERN",
    );
  }
}

/**
 * Classifies one bounded serial window and calculates change state.
 *
 * @param input - Serial evidence, assertions, and previous automation state.
 * @returns Health classification with redacted evidence.
 */
export function evaluateMonitorHealth(input: {
  serialOutput: string;
  expectedMarkers?: string[];
  rejectedPatterns?: string[];
  disconnected?: boolean;
  cursor?: string;
  previousDigest?: string;
  previousStatus?: MonitorHealthStatus;
  previousConsecutiveFailures?: number;
  observedAt?: string;
}): MonitorHealthResult {
  const expectedMarkers = input.expectedMarkers ?? [];
  const rejectedPatterns = input.rejectedPatterns ?? [];
  const evidenceBytes = Buffer.from(redactSecretsInText(input.serialOutput), "utf8");
  const evidence = evidenceBytes
    .subarray(Math.max(0, evidenceBytes.length - MAX_EVIDENCE_BYTES))
    .toString("utf8");
  const matchedExpectations = expectedMarkers.filter((pattern) =>
    compileBoundedPattern(pattern).test(evidence),
  );
  const unmatchedExpectations = expectedMarkers.filter(
    (pattern) => !matchedExpectations.includes(pattern),
  );
  const matchedRejectedPatterns = rejectedPatterns.filter((pattern) =>
    compileBoundedPattern(pattern).test(evidence),
  );

  let status: MonitorHealthStatus;
  if (input.disconnected) status = "disconnected";
  else if (matchedRejectedPatterns.length > 0) status = "failed";
  else if (!evidence.trim()) status = "silent";
  else if (unmatchedExpectations.length > 0) status = "degraded";
  else if (expectedMarkers.length === 0 && rejectedPatterns.length === 0) {
    status = "inconclusive";
  } else status = "healthy";

  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        status,
        matchedExpectations,
        unmatchedExpectations,
        matchedRejectedPatterns,
        evidence,
      }),
    )
    .digest("hex");
  const isFailure = ["degraded", "failed", "silent", "disconnected"].includes(
    status,
  );
  const consecutiveFailures = isFailure
    ? (input.previousConsecutiveFailures ?? 0) + 1
    : 0;
  const recovered =
    status === "healthy" &&
    input.previousStatus !== undefined &&
    input.previousStatus !== "healthy";

  const recommendedAction: Record<MonitorHealthStatus, string> = {
    healthy: "No action required; retain the cursor for the next bounded check.",
    degraded: "Inspect missing runtime markers and run a focused diagnostic capture.",
    failed: "Inspect the rejected runtime pattern before attempting another flash.",
    silent: "Confirm baud rate, firmware output, and the current device binding.",
    disconnected: "Reconnect and resolve the physical target before retrying.",
    inconclusive: "Provide expected or rejected markers for a meaningful health check.",
  };

  return {
    status,
    changed: digest !== input.previousDigest,
    recovered,
    cursor: input.cursor,
    digest,
    matchedExpectations,
    unmatchedExpectations,
    matchedRejectedPatterns,
    evidence,
    consecutiveFailures,
    recommendedAction: recommendedAction[status],
    observedAt: input.observedAt ?? new Date().toISOString(),
  };
}
