/** Own the PPK2 bridge process, preserving custody whenever device shutdown or descendant closure is uncertain. */
import path from "node:path";
import { DebugBackendProcess } from "../debug/debug-backend-process.js";
import type { ProcessDeviceCustody } from "../devices/process-device-custody.js";
import { PlatformIOError } from "../../utils/errors.js";
import { PPK2_BRIDGE } from "./ppk2-bridge.js";
import { Ppk2Protocol, Ppk2RequestSchema } from "./ppk2-protocol.js";

/** Host-only inputs: executable trust, permission and physical meter/DUT binding are resolved by the service. */
export interface Ppk2ProcessOptions {
  pythonExecutable: string;
  cwd: string;
  request: unknown;
  custody: ProcessDeviceCustody;
}
async function within(
  promise: Promise<unknown>,
  milliseconds: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Retain this owner before collect; every failed cleanup remains retryable through the same object. */
export class Ppk2Process {
  private readonly request;
  private readonly protocol: Ppk2Protocol;
  private backend?: DebugBackendProcess;
  private launchTask?: Promise<void>;
  private used = false;
  private requestSent = false;
  private stopSent = false;
  private stopRequested = false;
  private released = false;
  private failure?: unknown;
  private cleanupAttempt?: Promise<void>;
  private readonly terminal: Promise<void>;
  private resolveTerminal!: () => void;
  private readonly interrupted: Promise<void>;
  private resolveInterrupted!: () => void;

  /** Validate inert inputs before launching anything; construction grants no permission. */
  constructor(private readonly options: Ppk2ProcessOptions) {
    const parsed = Ppk2RequestSchema.safeParse(options.request);
    if (!parsed.success)
      throw new PlatformIOError(
        "Invalid PPK2 execution request.",
        "PPK2_REQUEST_INVALID",
      );
    this.request = parsed.data;
    this.protocol = new Ppk2Protocol(this.request);
    if (
      ![options.pythonExecutable, options.cwd].every(
        (value) => path.isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value),
      ) ||
      /\.(?:cmd|bat|ps1|sh)$/i.test(options.pythonExecutable)
    )
      throw new PlatformIOError(
        "PPK2 requires a host-resolved native interpreter and working directory.",
        "PPK2_EXECUTION_INVALID",
      );
    this.terminal = new Promise((resolve) => {
      this.resolveTerminal = resolve;
    });
    this.interrupted = new Promise((resolve) => {
      this.resolveInterrupted = resolve;
    });
  }

  /** Run once; graceful stop precedes forced group cleanup, and incomplete cleanup never releases custody. */
  async collect(signal?: AbortSignal) {
    if (this.used || this.stopRequested)
      throw new PlatformIOError(
        "PPK2 process owner is already used or closing.",
        "PPK2_OWNER_CLOSED",
      );
    this.used = true;
    const abort = () => {
      this.stopRequested = true;
      void this.sendStop();
      this.resolveInterrupted();
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) abort();
      this.launchTask = this.launch();
      if (!(await within(this.launchTask, 15000)))
        throw new PlatformIOError(
          "PPK2 startup timed out.",
          "PPK2_START_TIMEOUT",
        );
      if (
        !(await within(
          Promise.race([this.terminal, this.interrupted]),
          this.request.seconds * 1000 + 10000,
        ))
      )
        throw new PlatformIOError(
          "PPK2 collection timed out.",
          "PPK2_COLLECTION_TIMEOUT",
        );
      if (this.failure) throw this.failure;
      if (signal?.aborted || this.stopRequested)
        throw new PlatformIOError(
          "PPK2 collection cancelled.",
          "PPK2_CANCELLED",
        );
    } finally {
      signal?.removeEventListener("abort", abort);
      await this.cleanupProcess();
    }
    const report = this.protocol.snapshot();
    if (report.unavailable)
      throw new PlatformIOError(
        "The isolated Python environment cannot run the PPK2 bridge.",
        report.unavailable,
      );
    if (this.failure) throw this.failure;
    return report;
  }

  /** Cleanup state is independent of bridge outcome; callers must retain this capability while pending. */
  state() {
    const report = this.protocol.snapshot();
    return {
      cleanupPending: !this.released,
      processClosed:
        this.backend?.state().closed ?? (this.released || !this.launchTask),
      deviceCleanupReported: report.cleanupReported,
      powerMayBeOn:
        report.finished?.powerMayBeOn ??
        (this.requestSent && this.request.mode === "source"),
    };
  }

  /** Coalesce shutdown attempts; never release after a kill without a trustworthy device cleanup report. */
  cleanupProcess(): Promise<void> {
    if (this.released) return Promise.resolve();
    if (this.cleanupAttempt) return this.cleanupAttempt;
    this.stopRequested = true;
    const attempt = this.cleanup();
    this.cleanupAttempt = attempt;
    void attempt
      .finally(() => {
        this.cleanupAttempt = undefined;
      })
      .catch(() => {});
    return attempt;
  }

  private async launch(): Promise<void> {
    if (this.stopRequested)
      throw new PlatformIOError("PPK2 startup cancelled.", "PPK2_CANCELLED");
    await this.options.custody.prepareSpawn();
    if (this.stopRequested)
      throw new PlatformIOError("PPK2 startup cancelled.", "PPK2_CANCELLED");
    // Base64 carries fixed source through the supervisor's single-line argument contract, never request code.
    const program = `import base64;exec(compile(base64.b64decode("${Buffer.from(PPK2_BRIDGE).toString("base64")}"),"<pio-ppk2>","exec"))`;
    this.backend = new DebugBackendProcess({
      pythonExecutable: this.options.pythonExecutable,
      command: {
        executable: this.options.pythonExecutable,
        cwd: this.options.cwd,
        arguments: ["-I", "-c", program],
      },
      onStdout: (data) => {
        try {
          this.protocol.accept(data);
          if (this.protocol.snapshot().terminal) this.resolveTerminal();
        } catch (error) {
          this.failure = error;
          this.resolveInterrupted();
          void this.sendStop();
        }
      },
      onClose: () => {
        try {
          this.protocol.end();
        } catch (error) {
          this.failure = error;
        }
        this.resolveTerminal();
      },
    });
    await this.backend.waitStarted(10000);
    if (this.stopRequested)
      throw new PlatformIOError("PPK2 startup cancelled.", "PPK2_CANCELLED");
    // A partial/failed write is uncertain delivery, so mark it before sending.
    this.requestSent = true;
    await this.backend.writeStdin(
      Buffer.from(JSON.stringify(this.request) + "\n"),
    );
  }
  private async sendStop() {
    if (
      this.backend &&
      this.requestSent &&
      !this.stopSent &&
      !this.backend.state().closed
    ) {
      this.stopSent = true;
      await this.backend.writeStdin(Buffer.from("\n")).catch(() => {
        this.stopSent = false;
      });
    }
  }
  private async cleanup(): Promise<void> {
    await within(this.sendStop(), 1000);
    const launchComplete =
      !this.launchTask ||
      (await within(
        this.launchTask.catch(() => {}),
        15000,
      ));
    if (this.backend) {
      await within(this.sendStop(), 1000);
      if (
        this.requestSent &&
        !this.protocol.snapshot().terminal &&
        !this.backend.state().closed
      )
        await within(this.terminal, 3000);
      await this.backend.cleanupProcess();
      if (this.backend.state().cleanupPending || !this.backend.state().closed)
        this.pending();
    }
    if (!launchComplete) this.pending();
    const report = this.protocol.snapshot();
    if (
      this.requestSent &&
      (!report.ended || !report.cleanupReported || report.failed)
    )
      this.pending();
    this.options.custody.releaseAfterExit();
    this.released = true;
  }
  private pending(): never {
    throw new PlatformIOError(
      "PPK2 shutdown is unconfirmed; meter/DUT custody remains held.",
      "PPK2_CLEANUP_PENDING",
      { cleanupPending: true },
    );
  }
}
