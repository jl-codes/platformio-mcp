/** Bounded child-process completion tracking; a kill request never proves hardware release. */
import type { ChildProcess } from "node:child_process";
import { PlatformIOError } from "./errors.js";

/** Wait for confirmed exit, escalating via the original child handle and retaining uncertainty on timeout. */
export function waitForOwnedProcess(
  proc: ChildProcess,
  timeoutMs: number,
  graceMs = 1000,
  cancellation?: AbortSignal,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false,
      timedOut = false,
      cancelled = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      clearTimeout(escalation);
      clearTimeout(deadline);
      proc.off("exit", exited);
      proc.off("close", exited);
      proc.off("error", failed);
      cancellation?.removeEventListener("abort", cancel);
    };
    const exited = (code: number | null) => {
      if (settled) return;
      cleanup();
      if (timedOut || cancelled)
        reject(
          new PlatformIOError(
            cancelled
              ? "Command cancelled after startup failure."
              : `Command timed out after ${timeoutMs}ms`,
            cancelled ? "PROCESS_CANCELLED" : "COMMAND_TIMEOUT",
            { cleanupPending: false },
          ),
        );
      else resolve(code ?? 1);
    };
    const failed = (error: Error) => {
      if (settled) return;
      cleanup();
      reject(
        new PlatformIOError(error.message, "PROCESS_FAILED", {
          cleanupPending:
            !!proc.pid && proc.exitCode === null && proc.signalCode === null,
        }),
      );
    };
    const terminate = () => {
      if (settled) return;
      try {
        proc.kill("SIGTERM");
      } catch {}
      if (settled) return;
      escalation = setTimeout(() => {
        if (settled) return;
        try {
          proc.kill("SIGKILL");
        } catch {}
        if (settled) return;
        deadline = setTimeout(() => {
          if (settled) return;
          cleanup();
          reject(
            new PlatformIOError(
              "Child termination could not be confirmed.",
              "PROCESS_CLEANUP_PENDING",
              { cleanupPending: true },
            ),
          );
        }, graceMs);
      }, graceMs);
    };
    const cancel = () => {
      if (settled || cancelled || timedOut) return;
      cancelled = true;
      clearTimeout(timer);
      terminate();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    proc.once("exit", exited);
    proc.once("close", exited);
    proc.once("error", failed);
    cancellation?.addEventListener("abort", cancel, { once: true });
    if (proc.exitCode !== null || proc.signalCode !== null)
      exited(proc.exitCode);
    else if (cancellation?.aborted) cancel();
  });
}
