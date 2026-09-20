/** One-shot memory collection with discovered identity, policy checks, and owned cleanup. */
import { PlatformIOError } from "../../utils/errors.js";
import { captureSessionMemory, MemoryCaptureSchema } from "./memory-capture.js";
import type { PolicySerialSessionService } from "./session-policy.js";
import type { SerialSessionOwner } from "./session-manager.js";

/** Open only after validating capture options, then stop the owned session on every collection outcome. */
export async function captureTransientMemory(
  service: Pick<PolicySerialSessionService, "startWithDiscovery" | "sessions">,
  owner: SerialSessionOwner,
  request: Parameters<PolicySerialSessionService["startWithDiscovery"]>[1],
  input: Parameters<typeof captureSessionMemory>[3] = {},
  signal?: AbortSignal,
) {
  const args = MemoryCaptureSchema.parse(input);
  if (signal?.aborted)
    throw new PlatformIOError(
      "Memory capture was cancelled before startup.",
      "SERIAL_CANCELLED",
    );
  const started = await service.startWithDiscovery(owner, request);
  let report: Awaited<ReturnType<typeof captureSessionMemory>>;
  try {
    report = await captureSessionMemory(
      service.sessions,
      owner,
      started.sessionId,
      args,
      signal,
    );
  } catch (error) {
    const stopped = await service.sessions.stop(owner, started.sessionId);
    throw new PlatformIOError(
      error instanceof PlatformIOError
        ? error.message
        : "Memory capture failed.",
      error instanceof PlatformIOError ? error.code : "MEMORY_CAPTURE_FAILED",
      {
        ...(error instanceof PlatformIOError ? error.context : {}),
        sessionId: started.sessionId,
        cleanupPending: stopped.cleanupPending,
      },
    );
  }
  const stopped = await service.sessions.stop(owner, started.sessionId);
  return {
    ...report,
    ok: report.ok && !stopped.cleanupPending,
    collectionComplete: report.collectionComplete && !stopped.cleanupPending,
    cleanupPending: stopped.cleanupPending,
    state: stopped.state,
    port: started.path,
    baud: started.baudRate,
  };
}
