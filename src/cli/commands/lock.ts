import fs from "node:fs";
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";
import { hardwareLockManager } from "../../utils/lock-manager.js";
import { portSemaphoreManager } from "../../utils/semaphore.js";
import { GLOBAL_LOCKS_DIR } from "../../utils/paths.js";
import { asString, asBoolean } from "../args.js";
import type { CommandHandler } from "./types.js";

/**
 * Reports the process-scoped global pipeline lock alongside the cross-process
 * port claims. The `scope` field exists so an agent cannot mistake the global
 * lock for a cross-session guarantee: from a one-shot CLI process it is
 * always unlocked.
 */
export const lockStatus: CommandHandler = async (ctx) => {
  const portFilter = asString(ctx.options.port);

  const portClaims: Array<Record<string, unknown>> = [];
  if (fs.existsSync(GLOBAL_LOCKS_DIR)) {
    for (const file of fs.readdirSync(GLOBAL_LOCKS_DIR)) {
      // endsWith, not includes: "<port>.json.reclaim" and
      // "<port>.json.tmp.<pid>.<uuid>" are internal files, not claims.
      if (!file.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(
          fs.readFileSync(path.join(GLOBAL_LOCKS_DIR, file), "utf-8"),
        );
        const claim = parsed.current_claim ?? parsed;
        // Feed staleness the SAME normalised claim claimPort uses. A hand-built
        // object dropped monitor_pid, so a live monitor claim reported stale:true
        // from the very command agents are told to consult when a claim looks wrong.
        const normalised = portSemaphoreManager.getClaim(
          String(claim.port ?? file.replace(/\.json$/, "")),
        );
        if (!normalised) continue;
        if (!claim || typeof claim.owner_pid !== "number") continue;
        // Prefer the recorded port; fall back to the sanitised filename for
        // legacy claim files, which cannot round-trip the original path.
        const port = String(claim.port ?? file.replace(/\.json$/, ""));
        if (portFilter && !port.includes(portFilter)) continue;
        portClaims.push({
          port,
          type: claim.type,
          ownerPid: claim.owner_pid,
          ownerWorkspace: claim.owner_workspace,
          hostname: claim.hostname ?? "",
          // For a monitor claim this is the detached child that actually holds
          // the UART -- the process whose liveness decides staleness -- so it
          // is the field to look at when a monitor claim seems wrong.
          ...(typeof claim.monitor_pid === "number"
            ? { monitorPid: claim.monitor_pid }
            : {}),
          claimedAt: claim.timestamp,
          stale: portSemaphoreManager.isClaimStale(normalised),
        });
      } catch {
        // Skip unreadable claim files.
      }
    }
  }

  return {
    globalLock: {
      ...hardwareLockManager.getLockStatus(),
      scope: "process",
      note:
        "The global pipeline lock is in-process. It is meaningful only under " +
        "`pio-agent serve` and the dashboard, and is always unlocked when read " +
        "from a one-shot CLI invocation. Cross-process exclusion is provided by " +
        "port claims.",
    },
    portClaims,
  };
};

/**
 * Clears a port claim and any abandoned reclaim breaker. Without `--force`
 * it refuses to clear a claim held by a live foreign process. A wedged
 * breaker is unrecoverable any other way (see
 * `SemaphoreManager.withReclaimBreaker`'s doc comment), so clearing it is
 * reported separately from the claim release itself.
 */
export const portRelease: CommandHandler = async (ctx) => {
  const port = asString(ctx.options.port) ?? ctx.positionals[0];
  if (!port) {
    throw new PlatformIOError(
      "port release requires --port <port>",
      "MISSING_ARGUMENT",
      { argument: "port" },
    );
  }
  const force = asBoolean(ctx.options.force) ?? false;
  const claim = portSemaphoreManager.getClaim(port);
  const released = portSemaphoreManager.releasePort(port, { force });
  // An abandoned reclaim breaker is never auto-recovered, so clearing it is
  // part of what this command is for.
  const breakerCleared = portSemaphoreManager.clearReclaimBreaker(port);

  return {
    port,
    released,
    breakerCleared,
    forced: force,
    previousClaim: claim,
    message: released
      ? `Released claim on ${port}.`
      : claim
        ? `Refused: ${port} is held by a live claim from PID ${claim.owner_pid} ` +
          `in ${claim.owner_workspace}. Re-run with --force only if you are ` +
          `certain that process is finished.`
        : `No claim found on ${port}.`,
  };
};
