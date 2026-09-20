/** Internal startup failure retains a live cleanup capability without exposing it in public diagnostics. */
import { PlatformIOError } from "../../utils/errors.js";
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
