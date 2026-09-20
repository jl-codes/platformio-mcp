/** Own a supervised debug backend; process exit without explicit descendant cleanup proof never frees a probe. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";
import type { DebugServerCommand } from "./debug-server-config.js";
import { parseDebugServerCommand } from "./debug-server-config.js";
import { WINDOWS_BACKEND_SUPERVISOR } from "./windows-backend-supervisor.js";
import { POSIX_BACKEND_SUPERVISOR } from "./posix-backend-supervisor.js";

/** Host-resolved, separately authorized launcher input; public arguments cannot select these capabilities. */
export interface DebugBackendProcessOptions {
  pythonExecutable: string;
  command: DebugServerCommand;
  launch?: typeof spawn; // Trusted host/test dependency only.
}

/** The creator retains this object even if waitStarted fails, until cleanupProcess confirms all descendants exited. */
export class DebugBackendProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly closedPromise: Promise<void>;
  private readonly startedPromise: Promise<void>;
  private resolveStarted!: () => void;
  private resolveClosed!: () => void;
  private started = false;
  private closed = false;
  private confirmed = false;
  private failed = false;
  private protocolFailed = false;
  private terminal = false;
  private protocol = "";
  private controlBytes = 0;
  private output = Buffer.alloc(0);
  private outputBytes = 0;
  private backendPid?: number;
  private cleanupAttempt?: Promise<void>;

  /** Spawn only after host-code/target authorization, executable trust and probe custody are established. */
  constructor(options: DebugBackendProcessOptions) {
    if (
      !path.isAbsolute(options.pythonExecutable) ||
      /[\x00-\x1f\x7f]/.test(options.pythonExecutable) ||
      /\.(?:cmd|bat|ps1|sh)$/i.test(options.pythonExecutable)
    )
      throw new PlatformIOError(
        "Invalid backend supervisor interpreter.",
        "DEBUG_BACKEND_INPUT_INVALID",
      );
    const command = parseDebugServerCommand(
      options.command,
      options.command.cwd,
    );
    if (!command)
      throw new PlatformIOError(
        "A backend command is required.",
        "DEBUG_BACKEND_INPUT_INVALID",
      );
    if (!["win32", "linux", "darwin"].includes(process.platform))
      throw new PlatformIOError(
        "Unsupported debugger backend host.",
        "DEBUG_BACKEND_PLATFORM_UNSUPPORTED",
      );
    this.closedPromise = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    this.startedPromise = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
    this.child = (options.launch ?? spawn)(
      options.pythonExecutable,
      [
        "-I",
        "-c",
        process.platform === "win32"
          ? WINDOWS_BACKEND_SUPERVISOR
          : POSIX_BACKEND_SUPERVISOR,
      ],
      {
        cwd: command.cwd,
        shell: false,
        windowsHide: true,
        stdio: "pipe",
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUNBUFFERED: "1",
        },
      },
    ) as ChildProcessWithoutNullStreams;
    this.child.stdout.on("data", (data: Buffer) => this.readControl(data));
    this.child.stderr.on("data", (data: Buffer) => {
      this.outputBytes += data.length;
      this.output = Buffer.concat([this.output, data]).subarray(-16384);
      if (this.outputBytes > 1024 * 1024) this.fail();
    });
    this.child.on("error", () => {
      if (!this.child.pid) this.confirmed = true;
      this.fail();
    });
    for (const stream of [
      this.child.stdin,
      this.child.stdout,
      this.child.stderr,
    ])
      stream.on("error", () => this.fail());
    this.child.once("close", () => {
      this.closed = true;
      if (this.protocol.trim()) {
        this.failed = true;
        this.protocolFailed = true;
      }
      this.resolveClosed();
    });
    this.child.stdin.write(JSON.stringify(command) + "\n");
  }

  /** Await process creation, not protocol readiness; failures leave this cleanup owner available. */
  async waitStarted(timeoutMs = 10000): Promise<void> {
    this.validateTimeout(timeoutMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.startedPromise,
        this.closedPromise,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
      if (!this.started || this.failed || this.closed) {
        this.child.stdin.end();
        throw new PlatformIOError(
          "Debugger backend did not start.",
          "DEBUG_BACKEND_START_FAILED",
          { cleanupPending: !this.closed || !this.confirmed },
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** Bounded diagnostic output is not a readiness or device identity claim. */
  state() {
    return {
      pid: this.backendPid,
      started: this.started,
      closed: this.closed,
      failed: this.failed,
      cleanupPending: !this.closed || !this.confirmed || this.protocolFailed,
      outputTail: this.output.toString("utf8"),
    };
  }

  /** Close the owner pipe and require an explicit empty-job/group proof plus supervisor closure. */
  cleanupProcess(): Promise<void> {
    if (this.cleanupAttempt) return this.cleanupAttempt;
    const attempt = this.cleanup();
    this.cleanupAttempt = attempt;
    void attempt
      .finally(() => {
        this.cleanupAttempt = undefined;
      })
      .catch(() => {});
    return attempt;
  }

  private async cleanup(): Promise<void> {
    this.child.stdin.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!this.closed)
        await Promise.race([
          this.closedPromise,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 7000);
          }),
        ]);
    } finally {
      clearTimeout(timer);
    }
    if (!this.closed || !this.confirmed || this.protocolFailed)
      throw new PlatformIOError(
        "Debugger backend descendant cleanup is unconfirmed.",
        "DEBUG_BACKEND_CLEANUP_PENDING",
        { cleanupPending: true },
      );
  }

  private readControl(data: Buffer) {
    this.controlBytes += data.length;
    if (this.controlBytes > 16384) {
      this.protocolFailed = true;
      this.fail();
      return;
    }
    this.protocol += data.toString("utf8");
    let newline: number;
    while ((newline = this.protocol.indexOf("\n")) !== -1) {
      const line = this.protocol.slice(0, newline);
      this.protocol = this.protocol.slice(newline + 1);
      try {
        const event = JSON.parse(line);
        if (this.terminal) throw new Error("Control event after completion");
        if (
          event.event === "started" &&
          !this.started &&
          !this.confirmed &&
          Number.isSafeInteger(event.pid) &&
          event.pid > 0
        ) {
          this.backendPid = event.pid;
          this.started = true;
          this.resolveStarted();
        } else if (
          event.event === "stopped" &&
          this.started &&
          !this.confirmed &&
          typeof event.cleanupConfirmed === "boolean"
        ) {
          this.confirmed = event.cleanupConfirmed;
          this.terminal = true;
        } else if (
          event.event === "failed" &&
          !this.started &&
          event.cleanupConfirmed === true
        ) {
          this.confirmed = true;
          this.terminal = true;
        } else {
          this.protocolFailed = true;
          this.fail();
        }
      } catch {
        this.protocolFailed = true;
        this.fail();
      }
    }
  }

  private fail() {
    this.failed = true;
    this.child.stdin.end();
  }
  private validateTimeout(timeoutMs: number) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000)
      throw new PlatformIOError(
        "Invalid debugger backend deadline.",
        "DEBUG_BACKEND_INPUT_INVALID",
      );
  }
}
