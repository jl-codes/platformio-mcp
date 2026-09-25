/** Internal startup failure retains a live cleanup capability without exposing it in public diagnostics. */
import { PlatformIOError } from "../../utils/errors.js";
import type { ProcessDeviceCustody } from "../devices/process-device-custody.js";
import type { OwnedDebugProcess } from "./debug-client-sessions.js";

/** Only trusted startup code can supply the process; serialized errors cannot forge this capability. */
export class DebugStartupFailure extends PlatformIOError {
  #process: OwnedDebugProcess;
  constructor(process: OwnedDebugProcess) {
    super(
      "Debugger startup failed and cleanup remains pending.",
      "GDB_START_FAILED",
      { cleanupPending: true },
    );
    this.#process = process;
  }

  /** Retrieve the process for connection-owned cleanup tracking, never for public response serialization. */
  cleanupOwner(): OwnedDebugProcess {
    return this.#process;
  }
}

/** Retain retryable custody when startup failed before any child was created. */
export function retainUnstartedDebugCustody(
  custody: ProcessDeviceCustody,
): OwnedDebugProcess {
  let cleanupPending = true;
  return {
    command: async () => {
      throw new PlatformIOError("Debugger never started.", "GDB_CLOSED");
    },
    state: () => ({
      running: false,
      closed: true,
      failed: true,
      exitCode: null,
      lastStop: undefined,
      pid: undefined,
      stderr: "",
      cleanupPending,
    }),
    cleanupProcess: async () => {
      if (!cleanupPending) return;
      custody.releaseAfterExit();
      cleanupPending = false;
    },
  };
}
