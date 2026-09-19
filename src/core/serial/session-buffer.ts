/**
 * Bounded serial text storage and cursor reads, independent of device transport.
 * Provides SerialSessionBuffer with UTF-8 framing, loss accounting and cancellable waits.
 */
import { SerialStreamRedactor } from "./serial-redaction.js";
import { StringDecoder } from "node:string_decoder";
import { performance } from "node:perf_hooks";
import { PlatformIOError } from "../../utils/errors.js";
import { matchBoundedLines, type PatternOptions } from "../bounded-pattern.js";

/** Terminal state is retained even when unread lines remain. */
export type SerialBufferState = "open" | "stopped" | "disconnected" | "error";
/** Storage limits are independent from each caller's response limits. */
export interface SerialBufferLimits {
  maxLines?: number; // Default 5000, at most 10000 completed lines.
  maxBytes?: number; // Default 1 MiB, at most 8 MiB retained UTF-8 text.
  maxLineBytes?: number; // Default 16 KiB, at most 64 KiB per line or partial.
}
/** A cursor counts completed lines, not bytes or read calls. */
export interface SerialReadOptions {
  cursor?: number;
  maxLines?: number;
  maxBytes?: number;
  timeoutMs?: number;
  waitFor?: string;
  patternOptions?: Pick<
    PatternOptions,
    "mode" | "ignoreCase" | "pythonNamedGroups"
  >;
  signal?: AbortSignal;
}
/** A consistent bounded view; terminal state and cursor loss are independent of read outcome. */
export interface SerialBufferRead {
  redactionApplied: boolean; // Known-format filtering, not a guarantee that arbitrary secrets are detected.
  redactionOutputMayBeTruncated: boolean;
  lines: string[];
  lineTruncatedBytes: number[];
  cursor: number; // Next unread completed-line cursor.
  firstAvailableCursor: number;
  latestCursor: number;
  cursorStatus: "current" | "stale";
  droppedLines: number; // Lost completed lines since the requested cursor.
  moreAvailable: boolean;
  partial: string; // Returned only after all retained completed lines in this view.
  partialCursor: number;
  partialTruncatedBytes: number;
  state: SerialBufferState;
  error?: string;
  readStatus:
    | "ready"
    | "empty"
    | "matched"
    | "timeout"
    | "closed"
    | "cancelled";
  matched: boolean;
  receivedBytes: number;
  totalDroppedLines: number;
  totalDroppedBytes: number; // Evicted retained UTF-8 text, excluding line terminators.
  totalTruncatedBytes: number; // Decoded UTF-8 text omitted from overlong lines.
}
interface StoredLine {
  text: string;
  bytes: number;
  truncatedBytes: number;
  cursor: number;
}

/** Validate counters before they can become allocations, timers or cursor arithmetic. */
function boundedInteger(
  value: number,
  min: number,
  max: number,
  field: string,
): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new PlatformIOError(
      `Invalid serial ${field}; expected ${min} through ${max}.`,
      "SERIAL_BUFFER_ARGUMENT_INVALID",
    );
  return value;
}

/**
 * Ring storage with bounded partial lines and at most 32 pending readers.
 * This class does not authorize callers, open ports, acquire device locks or choose redaction policy. Optional filtering runs before storage and response budgets.
 * Those responsibilities belong to the owning session service and its public adapters.
 */
export class SerialSessionBuffer {
  private readonly capacity: number;
  private readonly byteCapacity: number;
  private readonly lineCapacity: number;
  private readonly ring: Array<StoredLine | undefined>;
  private readonly redactor?: SerialStreamRedactor;
  private redactionClipped = false;
  private readonly decoder = new StringDecoder("utf8");
  private readonly waiters = new Set<() => void>();
  private head = 0;
  private count = 0;
  private storedBytes = 0;
  private nextCursor = 0;
  private partial = "";
  private partialBytes = 0;
  private partialLost = 0;
  private previousCr = false;
  private revision = 0;
  private received = 0;
  private droppedLines = 0;
  private droppedBytes = 0;
  private truncatedBytes = 0;
  private state: SerialBufferState = "open";
  private error?: string;

  /** Construct storage limits; even empty lines consume one bounded ring entry. */
  constructor(limits: SerialBufferLimits = {}, redact = false) {
    if (redact) this.redactor = new SerialStreamRedactor();
    this.capacity = boundedInteger(
      limits.maxLines ?? 5000,
      1,
      10000,
      "maxLines",
    );
    this.byteCapacity = boundedInteger(
      limits.maxBytes ?? 1024 * 1024,
      4,
      8 * 1024 * 1024,
      "maxBytes",
    );
    this.lineCapacity = boundedInteger(
      limits.maxLineBytes ?? Math.min(16384, this.byteCapacity),
      4,
      Math.min(65536, this.byteCapacity),
      "maxLineBytes",
    );
    this.ring = new Array(this.capacity);
  }

  /** Append at most 1 MiB of transport bytes; late data after closure is ignored. */
  append(chunk: Buffer): boolean {
    if (this.state !== "open") return false;
    if (!Buffer.isBuffer(chunk) || chunk.length > 1024 * 1024)
      throw new PlatformIOError(
        "Serial chunks must be buffers no larger than 1 MiB.",
        "SERIAL_BUFFER_INPUT_LIMIT",
      );
    if (!chunk.length) return true;
    if (this.received > Number.MAX_SAFE_INTEGER - chunk.length)
      throw new PlatformIOError(
        "Serial byte counter exhausted.",
        "SERIAL_BUFFER_COUNTER_LIMIT",
      );
    this.received += chunk.length;
    this.acceptText(this.decoder.write(chunk));
    this.changed();
    return true;
  }

  /** Close once, retaining buffered data and flushing an incomplete final UTF-8 code point. */
  close(
    state: Exclude<SerialBufferState, "open"> = "stopped",
    error?: string,
  ): void {
    if (this.state !== "open") return;
    if (
      !["stopped", "disconnected", "error"].includes(state) ||
      (error !== undefined &&
        (typeof error !== "string" || error.length > 4096))
    )
      throw new PlatformIOError(
        "Invalid serial close state or error text.",
        "SERIAL_BUFFER_ARGUMENT_INVALID",
      );
    this.acceptText(this.decoder.end());
    this.state = state;
    this.error = error;
    this.changed();
  }

  /** Snapshot without waiting; no cursor is advanced beyond the data actually returned. */
  snapshot(
    options: Pick<SerialReadOptions, "cursor" | "maxLines" | "maxBytes"> = {},
  ): SerialBufferRead {
    const requested = boundedInteger(
      options.cursor ?? 0,
      0,
      this.nextCursor,
      "cursor",
    );
    const limit = boundedInteger(
      options.maxLines ?? 500,
      1,
      10000,
      "read maxLines",
    );
    const byteLimit = boundedInteger(
      options.maxBytes ?? Math.max(65536, this.lineCapacity),
      this.lineCapacity,
      1024 * 1024,
      "read maxBytes",
    );
    const first = this.count ? this.ring[this.head]!.cursor : this.nextCursor;
    let cursor = Math.max(first, requested),
      bytes = 0;
    const lines: string[] = [],
      lineTruncatedBytes: number[] = [];
    for (
      let offset = cursor - first;
      offset < this.count && lines.length < limit;
      offset++
    ) {
      const row = this.ring[(this.head + offset) % this.capacity]!;
      if (bytes + row.bytes > byteLimit) break;
      lines.push(row.text);
      lineTruncatedBytes.push(row.truncatedBytes);
      bytes += row.bytes;
      cursor = row.cursor + 1;
    }
    const renderedPartial = this.filterText(this.partial);
    const renderedPartialBytes = Buffer.byteLength(renderedPartial);
    const unreadLines = cursor < this.nextCursor;
    const showPartial =
      !unreadLines &&
      lines.length < limit &&
      bytes + renderedPartialBytes <= byteLimit;
    const moreAvailable =
      unreadLines || (!showPartial && this.partialBytes > 0);
    return {
      redactionApplied: !!this.redactor,
      redactionOutputMayBeTruncated: this.redactionClipped,
      lines,
      lineTruncatedBytes,
      cursor,
      firstAvailableCursor: first,
      latestCursor: this.nextCursor,
      cursorStatus: requested < first ? "stale" : "current",
      droppedLines: Math.max(0, first - requested),
      moreAvailable,
      partial: showPartial ? renderedPartial : "",
      partialCursor: this.nextCursor,
      partialTruncatedBytes: showPartial ? this.partialLost : 0,
      state: this.state,
      error: this.error,
      readStatus:
        this.state === "open"
          ? lines.length || (showPartial && this.partial.length)
            ? "ready"
            : "empty"
          : "closed",
      matched: false,
      receivedBytes: this.received,
      totalDroppedLines: this.droppedLines,
      totalDroppedBytes: this.droppedBytes,
      totalTruncatedBytes: this.truncatedBytes,
    };
  }

  /**
   * Read available text or wait for data/pattern, closure, cancellation or a bounded deadline.
   * A full response page returns immediately so callers can advance rather than lose unseen lines.
   * Regex evaluation uses the existing terminable worker; its separate 1-second execution
   * deadline can extend the read deadline. Matcher failure remains an explicit error.
   */
  async read(options: SerialReadOptions = {}): Promise<SerialBufferRead> {
    const timeout = boundedInteger(
      options.timeoutMs ?? 0,
      0,
      120000,
      "timeoutMs",
    );
    const deadline = performance.now() + timeout;
    const result = (
      view: SerialBufferRead,
      status: SerialBufferRead["readStatus"],
      matched = false,
    ): SerialBufferRead => ({
      ...view,
      state: this.state,
      error: this.error,
      readStatus: status,
      matched,
    });
    while (true) {
      const revision = this.revision;
      const view = this.snapshot(options);
      if (options.signal?.aborted) return result(view, "cancelled");
      let matched = false;
      if (options.waitFor !== undefined) {
        const inputs = view.partial
          ? [...view.lines, view.partial]
          : view.lines;
        matched =
          (
            await matchBoundedLines(inputs, options.waitFor, {
              ...options.patternOptions,
              timeoutMs: 1000,
            })
          ).length > 0;
      }
      if (options.signal?.aborted) return result(view, "cancelled");
      if (matched)
        return result(
          {
            ...view,
            moreAvailable:
              view.moreAvailable ||
              view.cursor < this.nextCursor ||
              (this.revision !== revision && this.partial !== view.partial),
          },
          "matched",
          true,
        );
      if (this.revision !== revision) {
        if (performance.now() >= deadline)
          return result(
            this.snapshot(options),
            this.state === "open" ? "timeout" : "closed",
          );
        continue;
      }
      if (this.state !== "open") return result(view, "closed");
      if (
        view.moreAvailable ||
        view.lines.length >= (options.maxLines ?? 500) ||
        (options.waitFor === undefined &&
          (view.lines.length > 0 || view.partial.length > 0))
      )
        return result(view, "ready");
      const remaining = deadline - performance.now();
      if (remaining <= 0)
        return result(view, timeout > 0 ? "timeout" : view.readStatus);
      await this.waitForChange(revision, remaining, options.signal);
    }
  }

  /** Frame CRLF or bare CR/LF once, retaining only a whole-code-point prefix of long lines. */
  private acceptText(text: string): void {
    for (const character of text) {
      if (character === "\n" && this.previousCr) {
        this.previousCr = false;
        continue;
      }
      this.previousCr = false;
      if (character === "\r" || character === "\n") {
        this.finishLine();
        this.previousCr = character === "\r";
        continue;
      }
      this.redactor?.observe(character);
      const bytes = Buffer.byteLength(character);
      if (this.partialLost || this.partialBytes + bytes > this.lineCapacity) {
        this.partialLost += bytes;
        this.truncatedBytes += bytes;
      } else {
        this.partial += character;
        this.partialBytes += bytes;
      }
      // The partial line shares the storage budget with completed lines.
      while (
        this.count &&
        this.storedBytes + this.partialBytes > this.byteCapacity
      )
        this.evict();
    }
  }

  private finishLine(): void {
    if (this.nextCursor === Number.MAX_SAFE_INTEGER)
      throw new PlatformIOError(
        "Serial line cursor exhausted.",
        "SERIAL_BUFFER_COUNTER_LIMIT",
      );
    const text = this.filterText(this.partial);
    const bytes = Buffer.byteLength(text);
    while (
      this.count &&
      (this.count === this.capacity ||
        this.storedBytes + bytes > this.byteCapacity)
    )
      this.evict();
    this.ring[(this.head + this.count) % this.capacity] = {
      text,
      bytes,
      truncatedBytes: this.partialLost,
      cursor: this.nextCursor++,
    };
    this.count++;
    this.storedBytes += bytes;
    this.redactor?.nextLine();
    this.partial = "";
    this.partialBytes = 0;
    this.partialLost = 0;
  }

  /** Apply filtering before response/storage budgeting; never split a UTF-8 code point. */
  private filterText(text: string): string {
    if (!this.redactor) return text;
    const filtered = this.redactor.preview(text);
    if (Buffer.byteLength(filtered) <= this.lineCapacity) return filtered;
    this.redactionClipped = true;
    let prefix = "",
      bytes = 0;
    for (const character of filtered) {
      const size = Buffer.byteLength(character);
      if (bytes + size > this.lineCapacity) break;
      prefix += character;
      bytes += size;
    }
    return prefix;
  }

  private evict(): void {
    const removed = this.ring[this.head]!;
    this.ring[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    this.storedBytes -= removed.bytes;
    this.droppedBytes += removed.bytes;
    this.droppedLines++;
  }

  private changed(): void {
    this.revision++;
    for (const notify of [...this.waiters]) notify();
  }

  /** Install the waiter before rechecking revision to avoid a lost arrival during async matching. */
  private waitForChange(
    revision: number,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.waiters.size >= 32)
      throw new PlatformIOError(
        "Too many pending serial readers.",
        "SERIAL_READ_BUSY",
      );
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, timeout);
      this.waiters.add(done);
      signal?.addEventListener("abort", done, { once: true });
      if (
        this.revision !== revision ||
        this.state !== "open" ||
        signal?.aborted
      )
        done();
    });
  }
}
