import type {
  DiagnosticMatcher,
  DiagnosticResult,
  DiagnosticStage,
} from "./types.js";

function trimEvidence(log: string, pattern: RegExp): string[] {
  const lines = log.split(/\r?\n/);
  const matches: string[] = [];
  for (const line of lines) {
    if (pattern.test(line)) {
      matches.push(line.trim());
      if (matches.length >= 4) break;
    }
  }
  return matches;
}

function inferDefaultRecommendation(stage: DiagnosticStage): string {
  if (stage === "build") return "Inspect compiler diagnostics and patch the smallest failing unit.";
  if (stage === "upload") return "Verify port/cable/boot mode, then retry upload.";
  if (stage === "monitor") return "Inspect runtime serial traces and confirm expected boot markers.";
  if (stage === "test") return "Inspect test output and resolve the first failing assertion.";
  if (stage === "device_discovery") return "Reconnect device and repeat discovery.";
  return "Inspect raw logs and retry after applying a minimal fix.";
}

export function diagnoseFromLog(
  stage: DiagnosticStage,
  logText: string,
  matchers: DiagnosticMatcher[],
  opts?: { taskId?: string; rawLogPath?: string; successOverride?: boolean },
): DiagnosticResult {
  const timestamp = new Date().toISOString();
  const normalized = logText || "";
  const succeeded = opts?.successOverride ?? false;

  if (succeeded) {
    return {
      success: true,
      stage,
      severity: "info",
      summary: `${stage} completed successfully.`,
      evidence: [],
      recommendedAction: "Proceed to the next workflow step.",
      safeToAutoRetry: true,
      rawLogPath: opts?.rawLogPath,
      taskId: opts?.taskId,
      timestamp,
    };
  }

  for (const matcher of matchers) {
    if (!matcher.pattern.test(normalized)) continue;
    return {
      success: false,
      stage,
      errorType: matcher.errorType,
      severity: matcher.severity ?? "error",
      summary: `${stage} failed with ${matcher.errorType}.`,
      evidence: trimEvidence(normalized, matcher.pattern),
      recommendedAction: matcher.recommendedAction,
      safeToAutoRetry: matcher.safeToAutoRetry ?? false,
      rawLogPath: opts?.rawLogPath,
      taskId: opts?.taskId,
      timestamp,
    };
  }

  return {
    success: false,
    stage,
    errorType: "Unknown",
    severity: "error",
    summary: `${stage} failed, but no known failure pattern matched.`,
    evidence: normalized
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(-4),
    recommendedAction: inferDefaultRecommendation(stage),
    safeToAutoRetry: false,
    rawLogPath: opts?.rawLogPath,
    taskId: opts?.taskId,
    timestamp,
  };
}

