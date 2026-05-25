/**
 * Runtime Assertions Engine
 *
 * Provides:
 * - evaluateRuntimeAssertions: Evaluates serial output against expected and rejected patterns.
 */

/**
 * Input parameters for runtime assertion evaluation.
 */
export interface RuntimeAssertionInput {
  serialOutput: string; // Raw serial output collected from the spooler window
  expectAll?: string[]; // Patterns that must appear in output
  rejectPatterns?: string[]; // Patterns that must not appear in output
  stabilityWindowSeconds?: number; // Required quiet window at tail of capture
  secondsSinceLastOutput?: number; // Age of the most recent observed serial line
}

/**
 * Structured runtime assertion result.
 */
export interface RuntimeAssertionResult {
  matchedExpectations: string[]; // Expected patterns that were observed
  unmatchedExpectations: string[]; // Expected patterns that were not observed
  rejectedPatterns: string[]; // Rejected patterns that were observed
  runtimeFailures: string[]; // Built-in runtime failure categories observed in output
  stabilityAchieved: boolean; // True when tail quiet-window requirement is met
}

type RuntimeFailureMatcher = {
  name: string;
  pattern: RegExp;
};

const RUNTIME_FAILURE_MATCHERS: RuntimeFailureMatcher[] = [
  { name: "Brownout", pattern: /brownout/i },
  { name: "PanicTrace", pattern: /guru meditation|panic|backtrace/i },
  { name: "WatchdogReset", pattern: /watchdog|wdt|task watchdog/i },
];

function includesPattern(haystack: string, pattern: string): boolean {
  return haystack.toLowerCase().includes(pattern.toLowerCase());
}

function collectBootLoopFailure(serialOutput: string, failures: Set<string>): void {
  const matches = serialOutput.match(/rst:/gi) ?? [];
  if (matches.length >= 2) {
    failures.add("BootLoop");
  }
}

/**
 * Evaluates serial output assertions and built-in runtime failure signatures.
 *
 * @param input - Assertion request and serial output payload.
 * @returns Structured runtime assertion result.
 */
export function evaluateRuntimeAssertions(
  input: RuntimeAssertionInput,
): RuntimeAssertionResult {
  const output = input.serialOutput ?? "";
  const expectAll = input.expectAll ?? [];
  const rejectPatterns = input.rejectPatterns ?? [];
  const stabilityWindowSeconds = input.stabilityWindowSeconds ?? 10;
  const secondsSinceLastOutput = input.secondsSinceLastOutput ?? 0;

  const matchedExpectations = expectAll.filter((pattern) =>
    includesPattern(output, pattern),
  );
  const unmatchedExpectations = expectAll.filter(
    (pattern) => !includesPattern(output, pattern),
  );
  const rejected = rejectPatterns.filter((pattern) =>
    includesPattern(output, pattern),
  );

  const runtimeFailures = new Set<string>();
  if (output.trim().length === 0) {
    runtimeFailures.add("NoSerialOutput");
  }

  for (const matcher of RUNTIME_FAILURE_MATCHERS) {
    if (matcher.pattern.test(output)) {
      runtimeFailures.add(matcher.name);
    }
  }
  collectBootLoopFailure(output, runtimeFailures);

  const stabilityAchieved =
    output.trim().length > 0 && secondsSinceLastOutput >= stabilityWindowSeconds;

  return {
    matchedExpectations,
    unmatchedExpectations,
    rejectedPatterns: rejected,
    runtimeFailures: Array.from(runtimeFailures),
    stabilityAchieved,
  };
}
