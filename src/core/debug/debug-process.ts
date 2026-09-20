/**
 * Own a GDB child, MI pipes and cleanup without confusing process exit with probe release.
 * Public adapters must authorize startup and resolve trusted executable/artifact/custody inputs.
 */
import {
  executeDebugInitialization,
  type DebugInitializationInput,
} from "./debug-init-execution.js";
import type { DebugInitArtifact } from "./debug-init-artifact.js";
import { DebugStartupFailure } from "./debug-start-failure.js";
import { spawn } from "node:child_process";
import {
  SupervisedDebugChild,
  type GdbProcessChild,
} from "./supervised-debug-child.js";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { PlatformIOError } from "../../utils/errors.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import type { ProcessDeviceCustody } from "../devices/process-device-custody.js";
import {
  attachDebuggerTarget,
  type DebugTargetSelection,
} from "./debug-target.js";
import { dispatchDebuggerCommand } from "./debug-command.js";
import {
  GDB_STARTUP_ARGS,
  initializeGdbInspection,
} from "./debug-initialization.js";
import { GdbMiSession } from "./gdb-mi-session.js";
import {
  discoverDebuggerRoots,
  resolveDebuggerExecutable,
} from "./debug-discovery.js";

/** Trusted process owner inputs; never accept this structure directly from MCP arguments. */
export interface DebugProcessOptions {
  executable: string;
  trustedDebuggerRoots?: readonly string[];
  systemInfo?: unknown; // Trusted host system-info result used for registered package discovery.
  projectDir: string;
  elfPath: string;
  custody: ProcessDeviceCustody;
  /** Prove debug servers/descendants no longer own the probe, beyond the direct GDB child. */
  confirmProbeReleased: () => Promise<boolean>;
  startupTimeoutMs?: number;
  supervisorPython?: string; // Host-resolved interpreter for whole-process-tree ownership.
  /** Trusted test/host integration dependency, not a caller-selectable executable launcher. */
  launch?: typeof spawn;
}

/** One owned debugger process; process-only cleanup never sends resume/reset/quit commands. */
export class DebugProcess {
  private readonly transport: GdbMiSession;
  private readonly decoder = new StringDecoder("utf8");
  private stderr = "";
  private closed = false;
  private released = false;
  private releaseAttempt?: Promise<boolean>;
  private cleanupAttempt?: Promise<void>;
  private readonly closedPromise: Promise<void>;
  private markClosed!: () => void;

  private constructor(
    private readonly child: GdbProcessChild,
    private readonly options: DebugProcessOptions,
  ) {
    this.closedPromise = new Promise((resolve) => {
      this.markClosed = resolve;
    });
    this.transport = new GdbMiSession(
      (line) =>
        new Promise((resolve, reject) => {
          child.stdin.write(line, (error) =>
            error ? reject(error) : resolve(),
          );
        }),
    );
    child.stdout.on("data", (chunk: Buffer) => {
      try {
        this.transport.accept(chunk);
      } catch {
        void this.cleanupProcess().catch(() => {});
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      // A tail is diagnostic only; stderr must never enter the MI result parser.
      this.stderr = (this.stderr + this.decoder.write(chunk)).slice(-16384);
    });
    const failed = (error: Error) => {
      this.transport.invalidate(error);
      void this.cleanupProcess().catch(() => {});
    };
    child.stdin.on("error", failed);
    child.stdout.on("error", failed);
    child.stderr.on("error", failed);
    child.on("error", failed);
    child.once("close", (code) => {
      this.closed = true;
      this.stderr = (this.stderr + this.decoder.end()).slice(-16384);
      this.transport.end(code);
      this.markClosed();
      void this.releaseIfConfirmed();
    });
  }

  /** Launch only after authorization; initialization failure always attempts bounded cleanup. */
  static async start(options: DebugProcessOptions): Promise<DebugProcess> {
    let child: GdbProcessChild;
    try {
      if (
        !path.isAbsolute(options.executable) ||
        !path.isAbsolute(options.projectDir)
      )
        throw new PlatformIOError(
          "Debugger paths must be host-resolved.",
          "GDB_PATH_INVALID",
        );
      const roots =
        options.trustedDebuggerRoots ??
        (await discoverDebuggerRoots(
          options.executable,
          options.systemInfo,
          options.projectDir,
        ));
      const executable = await resolveDebuggerExecutable(
        options.executable,
        roots,
        options.projectDir,
      );
      await options.custody.prepareSpawn();
      child = options.supervisorPython
        ? new SupervisedDebugChild(options.supervisorPython, {
            executable,
            cwd: options.projectDir,
            arguments: [...GDB_STARTUP_ARGS],
          })
        : ((options.launch ?? spawn)(executable, [...GDB_STARTUP_ARGS], {
            cwd: options.projectDir,
            shell: false,
            windowsHide: true,
            stdio: "pipe",
          }) as GdbProcessChild);
    } catch (error) {
      options.custody.releaseAfterExit();
      throw error;
    }
    const owner = new DebugProcess(child, options);
    try {
      if (child instanceof SupervisedDebugChild)
        await child.supervisor.waitStarted(options.startupTimeoutMs);
      await initializeGdbInspection(
        owner.transport,
        options.elfPath,
        options.startupTimeoutMs,
      );
      return owner;
    } catch (error) {
      await owner.cleanupProcess().catch(() => {});
      if (!owner.released) throw new DebugStartupFailure(owner);
      throw new PlatformIOError(
        error instanceof Error ? error.message : "Debugger startup failed.",
        "GDB_START_FAILED",
        {
          pid: child.pid,
          cleanupPending: !owner.released,
          stderr: owner.stderr,
        },
      );
    }
  }

  /** Attach only after the startup adapter has established probe/server custody. */
  attach(
    selection: Omit<DebugTargetSelection, "projectDir">,
    caller: PolicyEvaluationContext,
  ) {
    return attachDebuggerTarget(
      this.transport,
      { ...selection, projectDir: this.options.projectDir },
      caller,
    );
  }

  /** Execute Core initialization under this owner's actual project identity. */
  initialize(
    artifact: DebugInitArtifact,
    input: Omit<DebugInitializationInput, "projectDir">,
    caller: PolicyEvaluationContext,
  ) {
    return executeDebugInitialization(
      this.transport,
      artifact,
      { ...input, projectDir: this.options.projectDir },
      caller,
    );
  }

  /** Reauthorize every classified command using this process's actual project identity. */
  command(
    command: string,
    caller: PolicyEvaluationContext,
    timeoutMs = 30000,
    grants: { approvalId?: string; sessionId?: string } = {},
  ) {
    return dispatchDebuggerCommand(
      command,
      { ...grants, projectDir: this.options.projectDir },
      caller,
      (prepared) =>
        this.transport.execute(
          prepared.miCommand,
          timeoutMs,
          prepared.waitForStop,
        ),
    );
  }

  /** Observed process state and bounded diagnostics; closed alone does not mean probe released. */
  state() {
    return {
      ...this.transport.state(),
      pid: this.child.pid,
      cleanupPending: !this.released,
      stderr: this.stderr,
    };
  }

  /** Kill only the owned child, then require independent proof before releasing device custody. */
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
    if (this.child instanceof SupervisedDebugChild) {
      this.transport.invalidate(
        new Error("Debugger process cleanup requested."),
      );
      await this.child.supervisor.cleanupProcess();
    }
    if (!this.closed) {
      this.transport.invalidate(
        new Error("Debugger process cleanup requested."),
      );
      try {
        this.child.kill("SIGTERM");
      } catch {}
      if (!(await this.waitClosed(1000))) {
        try {
          this.child.kill("SIGKILL");
        } catch {}
        await this.waitClosed(1000);
      }
    }
    if (!this.closed || !(await this.releaseIfConfirmed()))
      throw new PlatformIOError(
        "Debugger/probe cleanup is not confirmed.",
        "GDB_CLEANUP_PENDING",
        { pid: this.child.pid, cleanupPending: true },
      );
  }

  private waitClosed(timeoutMs: number): Promise<boolean> {
    if (this.closed) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      void this.closedPromise.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  private releaseIfConfirmed(): Promise<boolean> {
    if (this.released) return Promise.resolve(true);
    if (!this.closed) return Promise.resolve(false);
    if (
      this.child instanceof SupervisedDebugChild &&
      this.child.supervisor.state().cleanupPending
    )
      return Promise.resolve(false);
    if (this.releaseAttempt) return this.releaseAttempt;
    const attempt = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const confirmed = await Promise.race([
          this.options.confirmProbeReleased(),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), 1000);
          }),
        ]);
        if (!confirmed) return false;
        this.options.custody.releaseAfterExit();
        this.released = true;
        return true;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    })();
    this.releaseAttempt = attempt;
    void attempt.finally(() => {
      this.releaseAttempt = undefined;
    });
    return attempt;
  }
}
