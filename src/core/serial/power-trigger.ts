/** Wait for fresh firmware output on an owned monitor before starting power measurement. */
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { matchBoundedLines } from "../bounded-pattern.js";
import { PlatformIOError } from "../../utils/errors.js";
import type {
  SerialSessionManager,
  SerialSessionOwner,
} from "./session-manager.js";

/** Trigger authority binds the existing session, pattern and wait duration; never a new meter port. */
export const PowerTriggerSchema = z
  .object({
    trigger: z.string().min(1).max(4096),
    seconds: z.number().finite().positive().max(600).default(10),
  })
  .strict();
/** Ignore buffered completed lines, authorize every read and return only a fully retained match. */
export async function waitForPowerTrigger(
  manager: Pick<SerialSessionManager, "list" | "read">,
  owner: SerialSessionOwner,
  sessionId: string,
  input: z.input<typeof PowerTriggerSchema>,
  signal?: AbortSignal,
) {
  const args = PowerTriggerSchema.parse(input);
  const selected = manager
    .list(owner)
    .find((session) => session.sessionId === sessionId);
  if (!selected)
    throw new PlatformIOError(
      "Trigger monitor is not owned by this connection.",
      "SERIAL_SESSION_NOT_FOUND",
    );
  if (selected.state !== "open")
    throw new PlatformIOError(
      "Trigger monitor is not open.",
      "POWER_TRIGGER_CLOSED",
    );
  let cursor = selected.nextCursor,
    lines = 0,
    bytes = 0;
  await matchBoundedLines([], args.trigger, {
    mode: "regex",
    pythonNamedGroups: true,
  });
  const started = performance.now(),
    deadline = started + args.seconds * 1000;
  while (performance.now() < deadline) {
    if (signal?.aborted)
      throw new PlatformIOError(
        "Power trigger wait cancelled.",
        "SERIAL_CANCELLED",
      );
    const page = await manager.read(owner, sessionId, {
      cursor,
      maxLines: Math.min(500, 10000 - lines),
      maxBytes: 65536,
      timeoutMs: Math.min(
        250,
        Math.max(0, Math.ceil(deadline - performance.now())),
      ),
      signal,
    });
    if (page.readStatus === "cancelled" || signal?.aborted)
      throw new PlatformIOError(
        "Power trigger wait cancelled.",
        "SERIAL_CANCELLED",
      );
    if (
      page.droppedLines ||
      page.lineTruncatedBytes.some((count) => count > 0) ||
      page.redactionOutputMayBeTruncated
    )
      throw new PlatformIOError(
        "Trigger evidence was dropped or truncated; no measurement started.",
        "POWER_TRIGGER_LOSS",
      );
    cursor = page.cursor;
    lines += page.lines.length;
    bytes += page.lines.reduce((sum, line) => sum + Buffer.byteLength(line), 0);
    if (bytes > 1024 * 1024)
      throw new PlatformIOError(
        "Trigger wait exceeded its byte budget.",
        "POWER_TRIGGER_LIMIT",
      );
    const matches = await matchBoundedLines(page.lines, args.trigger, {
      mode: "regex",
      pythonNamedGroups: true,
    });
    if (matches.length) {
      // Parsing occurs off-thread; policy changes during it must still prevent disclosure/measurement.
      const final = await manager.read(owner, sessionId, {
        cursor,
        maxLines: 1,
        maxBytes: 65536,
        timeoutMs: 0,
        signal,
      });
      if (final.readStatus === "cancelled" || signal?.aborted)
        throw new PlatformIOError(
          "Power trigger wait cancelled.",
          "SERIAL_CANCELLED",
        );
      if (final.state !== "open" || final.error)
        throw new PlatformIOError(
          "Trigger monitor closed before measurement could start.",
          "POWER_TRIGGER_CLOSED",
        );
      return {
        trigger_line: page.lines[matches[0]],
        trigger_offset_s: (performance.now() - started) / 1000,
        trigger_session_id: sessionId,
        trigger_cursor: page.cursor - page.lines.length + matches[0],
      };
    }
    if (page.state !== "open" || page.error)
      throw new PlatformIOError(
        "Trigger monitor closed before a matching line.",
        "POWER_TRIGGER_CLOSED",
      );
    if (lines >= 10000 || bytes >= 1024 * 1024)
      throw new PlatformIOError(
        "Trigger wait exceeded its evidence budget.",
        "POWER_TRIGGER_LIMIT",
      );
    if (!page.lines.length) await delay(1);
  }
  throw new PlatformIOError(
    "Power trigger did not arrive within the requested interval; no measurement started.",
    "POWER_TRIGGER_TIMEOUT",
  );
}
