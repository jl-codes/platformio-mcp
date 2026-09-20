/** Per-connection debugger ownership, bounded startup capacity and retryable probe cleanup. */
import { DebugStartupFailure } from "./debug-start-failure.js";
import { randomUUID } from "node:crypto";
import { PlatformIOError } from "../../utils/errors.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import type { DebugProcess } from "./debug-process.js";

/** Owned process operations; creation and probe authority stay in trusted startup adapters. */
export type OwnedDebugProcess = Pick<
  DebugProcess,
  "command" | "state" | "cleanupProcess"
>;

/** One authenticated connection owns this registry; request arguments never select its owner. */
export class DebugClientSessions {
  private readonly sessions = new Map<
    string,
    {
      process: OwnedDebugProcess;
      projectDir: string;
      environment: string;
    }
  >();
  private readonly starting = new Set<Promise<unknown>>();
  private readonly stopping = new Map<string, Promise<void>>();
  private closed = false;

  /** Reserve capacity before asynchronous startup and clean up if the connection closes meanwhile. */
  async start(
    projectDir: string,
    environment: string,
    launch: (sessionId: string) => Promise<OwnedDebugProcess>,
  ): Promise<string> {
    if (this.closed)
      throw new PlatformIOError(
        "Debugger client disconnected.",
        "DEBUG_CLIENT_CLOSED",
      );
    if (this.sessions.size + this.starting.size >= 8)
      throw new PlatformIOError(
        "This connection already owns eight debugger sessions.",
        "DEBUG_SESSION_LIMIT",
      );
    // Defer launch until its promise is tracked, including synchronous launch failures.
    const id = randomUUID();
    const pending = Promise.resolve().then(() => launch(id));
    this.starting.add(pending);
    try {
      const process = await pending;
      this.sessions.set(id, { process, projectDir, environment });
      if (this.closed) {
        await this.stop(id);
        throw new PlatformIOError(
          "Debugger client disconnected during startup.",
          "DEBUG_CLIENT_CLOSED",
        );
      }
      return id;
    } catch (error) {
      if (error instanceof DebugStartupFailure) {
        this.sessions.set(id, {
          process: error.cleanupOwner(),
          projectDir,
          environment,
        });
        throw new PlatformIOError(
          "Debugger startup failed; retry cleanup for the retained session.",
          "GDB_START_FAILED",
          { sessionId: id, cleanupPending: true },
        );
      }
      throw error;
    } finally {
      this.starting.delete(pending);
    }
  }

  /** Return only this connection's sessions; no global list or caller-provided owner identifier exists. */
  list() {
    return [...this.sessions].map(([id, entry]) => ({
      session_id: id,
      project_dir: entry.projectDir,
      env: entry.environment,
      ...entry.process.state(),
    }));
  }

  /** The process reauthorizes every command against its own project and this exact session ID. */
  command(
    id: string,
    command: string,
    caller: PolicyEvaluationContext,
    timeoutMs = 30000,
    approvalId?: string,
  ) {
    if (this.closed)
      throw new PlatformIOError(
        "Debugger client disconnected.",
        "DEBUG_CLIENT_CLOSED",
      );
    const entry = this.lookup(id);
    if (this.stopping.has(id))
      throw new PlatformIOError(
        "Debugger cleanup is in progress.",
        "DEBUG_SESSION_CLOSING",
      );
    return entry.process.command(command, caller, timeoutMs, {
      sessionId: id,
      approvalId,
    });
  }

  /** Process-only cleanup; adapters must separately authorize target resume/detach commands. */
  stop(id: string): Promise<void> {
    const existing = this.stopping.get(id);
    if (existing) return existing;
    const entry = this.lookup(id);
    const pending = Promise.resolve()
      .then(() => entry.process.cleanupProcess())
      .then(() => {
        this.sessions.delete(id);
      })
      .finally(() => this.stopping.delete(id));
    this.stopping.set(id, pending);
    return pending;
  }

  /** Refuse new work, await in-flight starts and retain failures for later cleanup retries. */
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.starting]);
    const results = await Promise.allSettled(
      [...this.sessions.keys()].map((id) => this.stop(id)),
    );
    return {
      cleanupPending: this.sessions.size > 0,
      failed: results.filter((result) => result.status === "rejected").length,
    };
  }

  private lookup(id: string) {
    const entry = this.sessions.get(id);
    if (!entry)
      throw new PlatformIOError(
        "No debugger session owned by this connection.",
        "DEBUG_SESSION_NOT_FOUND",
      );
    return entry;
  }
}
