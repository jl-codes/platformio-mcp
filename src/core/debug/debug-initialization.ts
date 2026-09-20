/**
 * Controlled GDB startup: disable implicit scripts and target calls before loading symbols.
 * The process owner must use GDB_STARTUP_ARGS and authorize startup/probe access separately.
 */
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";
import { GdbMiSession } from "./gdb-mi-session.js";

/** No user/project initialization or positional ELF is allowed before MI safety setup. */
export const GDB_STARTUP_ARGS: readonly string[] = Object.freeze([
  "-nx",
  "--quiet",
  "--interpreter=mi2",
  "-iex",
  "set auto-load off",
  "-iex",
  "set may-call-functions off",
]);

/** A failed initialization requires process cleanup, never continued interactive use. */
const attempted = new WeakSet<GdbMiSession>();

/**
 * Configure the transport before loading an already selected, retained ELF's symbols.
 * This does not flash/connect a target, run project scripts, or establish probe ownership.
 * @param session A fresh process transport launched with the fixed startup arguments.
 * @param elfPath Absolute host-selected immutable ELF snapshot, not a public executable argument.
 * @param timeoutMs Total initialization deadline, including every acknowledged setup command.
 */
export async function initializeGdbInspection(
  session: GdbMiSession,
  elfPath: string,
  timeoutMs = 30000,
): Promise<void> {
  if (attempted.has(session))
    throw new PlatformIOError(
      "Debugger initialization already attempted.",
      "GDB_INIT_REUSED",
    );
  if (
    !path.isAbsolute(elfPath) ||
    /[\x00-\x1f\x7f]/.test(elfPath) ||
    Buffer.byteLength(elfPath) > 4096 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 600000
  )
    throw new PlatformIOError(
      "Invalid debugger initialization arguments.",
      "GDB_INIT_INVALID",
    );
  attempted.add(session);
  const deadline = performance.now() + timeoutMs;
  // Repeat the early command-line settings over MI: an unsupported GDB setting
  // must fail closed, even if GDB merely printed an error while parsing -iex.
  const commands = [
    "-gdb-set auto-load off",
    "-gdb-set may-call-functions off",
    "-gdb-set pagination off",
    "-gdb-set confirm off",
    "-file-exec-and-symbols " + JSON.stringify(elfPath),
  ];
  try {
    for (const command of commands) {
      const remaining = Math.floor(deadline - performance.now());
      if (remaining < 1)
        throw new PlatformIOError(
          "Debugger initialization timed out.",
          "GDB_INIT_TIMEOUT",
        );
      const result = await session.execute(command, remaining);
      if (result.timedOut || result.closed || result.result?.class !== "done")
        throw new PlatformIOError(
          "Debugger rejected or did not finish controlled initialization.",
          "GDB_INIT_FAILED",
          { resultClass: result.result?.class, timedOut: result.timedOut },
        );
    }
  } catch (error) {
    session.invalidate(error);
    throw new PlatformIOError(
      error instanceof Error
        ? error.message
        : "Debugger initialization failed.",
      "GDB_INIT_FAILED",
      { cleanupPending: !session.state().closed },
    );
  }
}
