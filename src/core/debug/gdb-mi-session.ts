/**
 * Token-correlated, bounded GDB/MI command transport state.
 * The owner must authorize commands, configure GDB safely and retain probe custody until process cleanup.
 */
import { StringDecoder } from "node:string_decoder";
import { PlatformIOError } from "../../utils/errors.js";
import { GdbMiFramer, type GdbMiRecord } from "./gdb-mi.js";

type ResultRecord = Extract<
  GdbMiRecord,
  { kind: "result" | "exec" | "status" | "notify" }
>;
/** One command's observed result; timeout never claims the target or debugger stopped. */
export interface GdbMiCommandResult {
  token: string;
  result?: ResultRecord;
  stopped?: ResultRecord;
  console: string[];
  truncated: boolean;
  timedOut: boolean;
  running: boolean;
  closed: boolean;
  exitCode: number | null;
}
interface PendingCommand {
  token: string;
  waitForStop: boolean;
  result?: ResultRecord;
  stopped?: ResultRecord;
  console: string[];
  bytes: number;
  truncated: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: GdbMiCommandResult) => void;
  reject: (error: Error) => void;
}
const MAX_OUTPUT_BYTES = 1024 * 1024;

/** A single command can be outstanding because MI console streams carry no command token. */
export class GdbMiSession {
  private readonly framer = new GdbMiFramer();
  private pending?: PendingCommand;
  private sequence = 0n;
  private failure?: PlatformIOError;
  private running = false;
  private closed = false;
  private exitCode: number | null = null;
  private lastStop?: ResultRecord;

  /** The trusted writer must preserve ordering and report pipe failures. It grants no authorization. */
  constructor(private readonly write: (line: string) => Promise<void>) {}

  /** Return observed target/process state without confusing a transport fault with confirmed exit. */
  state() {
    return {
      running: this.running,
      closed: this.closed,
      exitCode: this.exitCode,
      failed: !!this.failure,
      lastStop: this.lastStop,
    };
  }

  /** Send one already-authorized MI command. Timeouts release the request slot, not the probe. */
  execute(
    command: string,
    timeoutMs = 30000,
    waitForStop = false,
  ): Promise<GdbMiCommandResult> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed)
      return Promise.reject(
        new PlatformIOError("Debugger process has exited.", "GDB_CLOSED"),
      );
    if (this.pending)
      return Promise.reject(
        new PlatformIOError(
          "A debugger command is pending.",
          "GDB_COMMAND_BUSY",
        ),
      );
    if (
      typeof command !== "string" ||
      !/^-[a-z][a-z0-9-]*(?:[ \t].*)?$/.test(command) ||
      /[\r\n\x00]/.test(command) ||
      Buffer.byteLength(command) > 8192 ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 600000 ||
      typeof waitForStop !== "boolean"
    )
      return Promise.reject(
        new PlatformIOError(
          "Invalid debugger command transport arguments.",
          "GDB_COMMAND_INVALID",
        ),
      );
    const token = (++this.sequence).toString();
    if (token.length > 32)
      return Promise.reject(
        new PlatformIOError("Debugger token space exhausted.", "GDB_MI_LIMIT"),
      );
    return new Promise((resolve, reject) => {
      const pending: PendingCommand = {
        token,
        waitForStop,
        console: [],
        bytes: 0,
        truncated: false,
        timer: setTimeout(() => this.complete(pending, true), timeoutMs),
        resolve,
        reject,
      };
      this.pending = pending;
      // Install pending state before writing: an in-process transport can respond synchronously.
      try {
        void this.write(token + command + "\n").catch((error) =>
          this.fail(error),
        );
      } catch (error) {
        this.fail(error);
      }
    });
  }

  /** Consume stdout and return parsed records for the owner's event/log dispatcher. */
  accept(chunk: Uint8Array): GdbMiRecord[] {
    if (this.failure) throw this.failure;
    if (this.closed)
      throw new PlatformIOError("Debugger process has exited.", "GDB_CLOSED");
    try {
      const records = this.framer.push(chunk);
      for (const record of records) this.observe(record);
      return records;
    } catch (error) {
      this.fail(error);
      throw this.failure;
    }
  }

  /** Called only after the process owner observes exit/closed pipes, not after a kill request. */
  end(exitCode: number | null): void {
    if (this.closed) return;
    this.closed = true;
    this.exitCode = exitCode;
    if (!this.failure) {
      try {
        for (const record of this.framer.finish()) this.observe(record);
      } catch (error) {
        this.fail(error);
      }
    }
    if (this.pending) this.complete(this.pending, false);
  }

  private observe(record: GdbMiRecord): void {
    if (record.kind === "exec") {
      if (record.class === "running") this.running = true;
      if (record.class === "stopped") {
        this.running = false;
        this.lastStop = record;
        if (this.pending) this.pending.stopped = record;
      }
    }
    const pending = this.pending;
    if (!pending) return;
    if (record.kind === "stream" || record.kind === "other") {
      const bytes = Buffer.from(record.text);
      const remaining = MAX_OUTPUT_BYTES - pending.bytes;
      if (remaining > 0 && pending.console.length < 4096) {
        const selected = bytes.subarray(0, remaining);
        pending.console.push(new StringDecoder("utf8").write(selected));
        pending.bytes += selected.length;
      } else pending.truncated = true;
      if (bytes.length > remaining) pending.truncated = true;
    }
    if (record.kind === "result" && record.token === pending.token) {
      pending.result = record;
      if (record.class === "running" && !pending.stopped) this.running = true;
    }
    if (
      pending.result &&
      (!pending.waitForStop ||
        pending.stopped ||
        pending.result.class === "error" ||
        pending.result.class === "exit")
    )
      this.complete(pending, false);
  }

  private complete(pending: PendingCommand, timedOut: boolean): void {
    if (this.pending !== pending) return;
    clearTimeout(pending.timer);
    this.pending = undefined;
    pending.resolve({
      token: pending.token,
      result: pending.result,
      stopped: pending.stopped,
      console: pending.console,
      truncated: pending.truncated,
      timedOut,
      running: this.running,
      closed: this.closed,
      exitCode: this.exitCode,
    });
  }

  private fail(error: unknown): void {
    this.failure = new PlatformIOError(
      error instanceof Error ? error.message : "Debugger transport failed.",
      "GDB_TRANSPORT_FAILED",
      { cleanupPending: !this.closed },
    );
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(this.failure);
      this.pending = undefined;
    }
  }
}
