/** Bounded child-process completion tracking; a kill request never proves hardware release. */
import type { ChildProcess } from "node:child_process";
import { PlatformIOError } from "./errors.js";

/** Wait for confirmed exit, escalating via the original child handle and retaining uncertainty on timeout. */
export function waitForOwnedProcess(
  proc: ChildProcess,
  timeoutMs: number,
  graceMs = 1000,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false,
      timedOut = false;
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
    };
    const exited = (code: number | null) => {
      if (settled) return;
      cleanup();
      if (timedOut)
        reject(
          new PlatformIOError(
            `Command timed out after ${timeoutMs}ms`,
            "COMMAND_TIMEOUT",
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
    const timer = setTimeout(() => {
      timedOut = true;
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
    }, timeoutMs);
    proc.once("exit", exited);
    proc.once("close", exited);
    proc.once("error", failed);
    if (proc.exitCode !== null || proc.signalCode !== null)
      exited(proc.exitCode);
  });
}
