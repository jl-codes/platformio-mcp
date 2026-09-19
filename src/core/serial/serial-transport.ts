/**
 * Direct serial transport with bounded operations and independently confirmed physical closure.
 * Provides DirectSerialTransport and createDirectSerialTransport; authorization/leases belong to the session service.
 */
import { loadSerialBackend } from "./serial-backend.js";
import type { EventEmitter } from "node:events";
import { PlatformIOError } from "../../utils/errors.js";

/** Minimal maintained-SerialPort interface, also implemented by its official mock binding. */
export interface SerialPortHandle extends EventEmitter {
  readonly isOpen: boolean;
  readonly opening?: boolean;
  readonly closing?: boolean;
  open(callback: (error: Error | null) => void): void;
  close(callback: (error: Error | null) => void): void;
  write(bytes: Buffer, callback: (error?: Error | null) => void): boolean;
  drain(callback: (error?: Error | null) => void): void;
}
/** Opening a serial port can toggle device control lines; this operation requires hardware authorization. */
export interface DirectSerialOptions {
  path: string;
  baudRate: number;
  operationTimeoutMs?: number; // Default 5 seconds; 1 through 30,000 ms.
}
/** A timeout/error is not proof that the operating-system handle has been closed. */
export type SerialTransportState =
  | "idle"
  | "opening"
  | "open"
  | "closing"
  | "stopped"
  | "disconnected"
  | "error";

/** Validate before constructing a native binding or starting any device operation. */
export function validateDirectSerialOptions(
  options: DirectSerialOptions,
): number {
  const timeout = options.operationTimeoutMs ?? 5000;
  if (
    typeof options.path !== "string" ||
    !options.path ||
    options.path.length > 512 ||
    /[\x00-\x1f\x7f]/.test(options.path) ||
    !Number.isSafeInteger(options.baudRate) ||
    options.baudRate < 1 ||
    options.baudRate > 4000000 ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 30000
  )
    throw new PlatformIOError(
      "Invalid direct serial options.",
      "SERIAL_TRANSPORT_ARGUMENT_INVALID",
    );
  return timeout;
}

/**
 * Owns one already-constructed, unopened SerialPort stream. No automatic reopen or write retry occurs.
 * Wait for confirmedClosed before releasing a device lease, including after a failed open/write/close.
 */
export class DirectSerialTransport {
  readonly confirmedClosed: Promise<void>;
  readonly terminated: Promise<"stopped" | "disconnected" | "error">;
  private resolveTerminated!: (
    state: "stopped" | "disconnected" | "error",
  ) => void;
  private resolveClosed!: () => void;
  private physicallyClosed = false;
  private current: SerialTransportState = "idle";
  private terminal?: "stopped" | "disconnected" | "error";
  private opening = false;
  private closing = false;
  private writing = false;
  private closeAttempt?: {
    promise: Promise<void>;
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  };
  private readonly timeout: number;
  private readonly pending = new Set<(error: Error) => void>();

  /** Internal binding injection is for runtime construction/tests, never a tool argument. */
  constructor(
    private readonly port: SerialPortHandle,
    options: DirectSerialOptions,
    private readonly onData: (bytes: Buffer) => void,
  ) {
    this.timeout = validateDirectSerialOptions(options);
    if (port.isOpen || port.opening || port.closing)
      throw new PlatformIOError(
        "Serial transport requires an unopened binding.",
        "SERIAL_TRANSPORT_ARGUMENT_INVALID",
      );
    this.terminated = new Promise((resolve) => {
      this.resolveTerminated = resolve;
    });
    this.confirmedClosed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    port.on("data", (bytes: Buffer) => {
      if (this.terminal) return;
      if (!Buffer.isBuffer(bytes)) {
        this.fail(
          new PlatformIOError(
            "Serial binding returned non-binary data.",
            "SERIAL_TRANSPORT_FAILED",
          ),
        );
        return;
      }
      try {
        // Bound each callback even if a custom binding emits a large chunk.
        for (let offset = 0; offset < bytes.length; offset += 65536)
          this.onData(bytes.subarray(offset, offset + 65536));
      } catch {
        this.fail(
          new PlatformIOError(
            "Serial data consumer failed.",
            "SERIAL_TRANSPORT_FAILED",
          ),
        );
      }
    });
    port.on("error", () =>
      this.fail(
        new PlatformIOError(
          "Serial transport failed.",
          "SERIAL_TRANSPORT_FAILED",
        ),
      ),
    );
    port.on("close", () => {
      this.markTerminal("disconnected");
      this.finishClosed();
    });
  }

  /** Current logical state; only confirmedClosed proves that ownership may be released. */
  get state(): SerialTransportState {
    return this.terminal ?? this.current;
  }

  /** Open once; a late success after timeout/stop is immediately closed and never becomes usable. */
  async open(): Promise<void> {
    if (this.current !== "idle" || this.terminal)
      throw new PlatformIOError(
        "Serial transport cannot be reopened.",
        "SERIAL_TRANSPORT_STATE_INVALID",
      );
    this.current = "opening";
    this.opening = true;
    await this.operation((done) => {
      try {
        this.port.open((error) => {
          this.opening = false;
          if (error) {
            const failure = new PlatformIOError(
              "Could not open serial port.",
              "SERIAL_OPEN_FAILED",
            );
            this.fail(failure);
            if (!this.port.isOpen) this.finishClosed();
            done(failure);
          } else if (this.terminal) {
            this.requestClose();
            done(
              new PlatformIOError(
                "Serial open was cancelled.",
                "SERIAL_CLOSED",
              ),
            );
          } else {
            this.current = "open";
            done();
          }
        });
      } catch {
        this.opening = false;
        const failure = new PlatformIOError(
          "Could not open serial port.",
          "SERIAL_OPEN_FAILED",
        );
        this.fail(failure);
        if (!this.port.isOpen) this.finishClosed();
        done(failure);
      }
    }, "SERIAL_OPEN_TIMEOUT");
  }

  /** Write at most 64 KiB once, then wait for OS drain. This does not assert device-level acknowledgement. */
  async write(bytes: Buffer): Promise<{ bytesWritten: number; drained: true }> {
    if (!Buffer.isBuffer(bytes) || bytes.length > 65536)
      throw new PlatformIOError(
        "Serial writes are limited to 64 KiB.",
        "SERIAL_WRITE_LIMIT",
      );
    if (this.state !== "open" || !this.port.isOpen)
      throw new PlatformIOError("Serial port is not open.", "SERIAL_CLOSED");
    if (this.writing)
      throw new PlatformIOError(
        "A serial write is already in progress.",
        "SERIAL_WRITE_BUSY",
      );
    if (!bytes.length) return { bytesWritten: 0, drained: true };
    const copy = Buffer.from(bytes);
    this.writing = true;
    try {
      await this.operation((done) => {
        this.port.write(copy, (error) => {
          if (error)
            return done(
              new PlatformIOError(
                "Serial write failed; some bytes may have been sent.",
                "SERIAL_WRITE_FAILED",
              ),
            );
          if (this.terminal)
            return done(
              new PlatformIOError(
                "Serial connection closed during write.",
                "SERIAL_CLOSED",
              ),
            );
          try {
            this.port.drain((drainError) =>
              done(
                drainError
                  ? new PlatformIOError(
                      "Serial drain failed; some bytes may have been sent.",
                      "SERIAL_WRITE_FAILED",
                    )
                  : undefined,
              ),
            );
          } catch {
            done(
              new PlatformIOError(
                "Serial drain failed.",
                "SERIAL_WRITE_FAILED",
              ),
            );
          }
        });
      }, "SERIAL_WRITE_TIMEOUT");
      return { bytesWritten: copy.length, drained: true };
    } finally {
      this.writing = false;
    }
  }

  /** Request shutdown and wait boundedly; timeout leaves confirmedClosed pending until actual closure. */
  async close(): Promise<void> {
    this.markTerminal("stopped");
    this.abortPending(
      new PlatformIOError("Serial operation stopped.", "SERIAL_CLOSED"),
    );
    if (this.closeAttempt) return this.closeAttempt.promise;
    this.requestClose();
    if (this.physicallyClosed) return;
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const timer = setTimeout(() => {
      this.closeAttempt = undefined;
      reject(
        new PlatformIOError(
          "Serial closure is not confirmed; retain the device lease.",
          "SERIAL_CLOSE_TIMEOUT",
        ),
      );
    }, this.timeout);
    this.closeAttempt = { promise, resolve, timer };
    return promise;
  }

  private operation(
    start: (done: (error?: Error) => void) => void,
    timeoutCode: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pending.delete(finish);
        if (error) {
          reject(error);
          this.fail(error);
        } else resolve();
      };
      const timer = setTimeout(
        () =>
          finish(
            new PlatformIOError(
              "Serial operation timed out; effects may be partial.",
              timeoutCode,
            ),
          ),
        this.timeout,
      );
      this.pending.add(finish);
      try {
        start(finish);
      } catch {
        finish(
          new PlatformIOError(
            "Serial operation failed.",
            "SERIAL_TRANSPORT_FAILED",
          ),
        );
      }
    });
  }

  private markTerminal(state: "stopped" | "disconnected" | "error"): void {
    if (this.terminal) return;
    this.terminal = state;
    this.resolveTerminated(state);
  }

  private abortPending(error: Error): void {
    for (const reject of [...this.pending]) reject(error);
  }

  private fail(error: Error): void {
    this.markTerminal("error");
    this.abortPending(error);
    this.requestClose();
  }

  private requestClose(): void {
    if (
      this.physicallyClosed ||
      this.opening ||
      this.closing ||
      this.port.opening ||
      this.port.closing
    )
      return;
    if (!this.port.isOpen) {
      this.finishClosed();
      return;
    }
    this.closing = true;
    this.current = "closing";
    try {
      this.port.close((error) => {
        this.closing = false;
        if (!error && !this.port.isOpen) this.finishClosed();
        // Failed close stays unconfirmed; an explicit later close() can retry.
      });
    } catch {
      this.closing = false;
    }
  }

  private finishClosed(): void {
    if (
      this.physicallyClosed ||
      this.opening ||
      this.port.isOpen ||
      this.port.opening ||
      this.port.closing
    )
      return;
    this.physicallyClosed = true;
    this.closing = false;
    this.markTerminal("stopped");
    this.abortPending(
      new PlatformIOError("Serial connection closed.", "SERIAL_CLOSED"),
    );
    this.resolveClosed();
    if (this.closeAttempt) {
      clearTimeout(this.closeAttempt.timer);
      this.closeAttempt.resolve();
      this.closeAttempt = undefined;
    }
  }
}

/** Load the pinned optional native backend without opening or enumerating any device. */
export async function createDirectSerialTransport(
  options: DirectSerialOptions,
  onData: (bytes: Buffer) => void,
): Promise<DirectSerialTransport> {
  validateDirectSerialOptions(options);
  if (Number(process.versions.node.split(".")[0]) < 20)
    throw new PlatformIOError(
      "Direct serial transport requires Node 20 or newer; the PlatformIO monitor remains available.",
      "SERIAL_BACKEND_UNAVAILABLE",
    );
  try {
    const { SerialPort } = await loadSerialBackend();
    const port = new SerialPort({
      path: options.path,
      baudRate: options.baudRate,
      autoOpen: false,
      lock: true,
      highWaterMark: 16384,
    });
    return new DirectSerialTransport(port, options, onData);
  } catch {
    throw new PlatformIOError(
      "The pinned serialport native backend is unavailable on this installation.",
      "SERIAL_BACKEND_UNAVAILABLE",
    );
  }
}
