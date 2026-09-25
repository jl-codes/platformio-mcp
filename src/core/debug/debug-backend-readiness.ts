/** Wait for bounded backend readiness evidence without making an extra GDB connection or evaluating regex on the server thread. */
import { setTimeout as delay } from "node:timers/promises";
import { PlatformIOError } from "../../utils/errors.js";
import { matchBoundedLines } from "../bounded-pattern.js";
import type { DebugBackendProcess } from "./debug-backend-process.js";

/** Validate the configured expression before backend/probe startup. */
export async function validateBackendReadyPattern(
  pattern: string,
): Promise<void> {
  if (typeof pattern !== "string" || !pattern.trim() || pattern.length > 4096)
    throw new PlatformIOError(
      "A bounded backend readiness pattern is required.",
      "DEBUG_READY_PATTERN_INVALID",
    );
  const matches = await matchBoundedLines([""], pattern, {
    mode: "regex",
    pythonNamedGroups: true,
  });
  if (matches.length)
    throw new PlatformIOError(
      "Backend readiness must require observed output.",
      "DEBUG_READY_PATTERN_INVALID",
    );
}

/** Wait only on this owned process's output; a matching log cannot override exit, failure, cancellation or revoked policy. */
export async function waitForBackendReady(
  backend: Pick<DebugBackendProcess, "state">,
  pattern: string,
  options: { timeoutMs: number; signal?: AbortSignal; guard: () => void },
): Promise<void> {
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 600000
  )
    throw new PlatformIOError(
      "Invalid debugger readiness deadline.",
      "DEBUG_READY_LIMIT_INVALID",
    );
  const deadline = performance.now() + options.timeoutMs;
  const check = () => {
    options.guard();
    if (options.signal?.aborted)
      throw new PlatformIOError(
        "Debugger readiness cancelled.",
        "DEBUG_CANCELLED",
      );
    if (performance.now() >= deadline)
      throw new PlatformIOError(
        "Debugger backend did not become ready before its deadline.",
        "DEBUG_BACKEND_READY_TIMEOUT",
      );
    const state = backend.state();
    if (state.failed || state.closed)
      throw new PlatformIOError(
        "Debugger backend exited or failed before readiness.",
        "DEBUG_BACKEND_NOT_READY",
        { outputTail: state.outputTail },
      );
    return state;
  };
  check();
  await validateBackendReadyPattern(pattern);
  let previous: string | undefined;
  while (true) {
    const state = check();
    if (state.started && state.outputTail !== previous) {
      previous = state.outputTail;
      const matches = await matchBoundedLines([state.outputTail], pattern, {
        mode: "regex",
        pythonNamedGroups: true,
        timeoutMs: Math.max(
          1,
          Math.min(1000, Math.floor(deadline - performance.now())),
        ),
      });
      const current = check();
      if (matches.length && current.started) return;
    }
    await delay(Math.min(25, Math.max(1, deadline - performance.now())));
  }
}
