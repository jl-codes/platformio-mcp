/** Connection-owned preparation checkpoints preserve completed effects across single-use approval retries. */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { PlatformIOError } from "../../utils/errors.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import {
  parseDebugPreparationArguments,
  prepareDebuggerProject,
  type DebugPreparationCheckpoint,
} from "./debug-project.js";

/** One authenticated connection owns this bounded cache; successful startup should forget its preparation. */
export class DebugPreparationCache {
  private readonly entries = new Map<
    string,
    {
      expires: number;
      guard: () => void;
      values: Map<string, unknown>;
      busy: boolean;
    }
  >();
  private closed = false;

  /** Resume only the same validated project/request/caller while the captured policy revision remains current. */
  async prepare(
    input: unknown,
    caller: PolicyEvaluationContext = {},
    signal?: AbortSignal,
  ) {
    if (this.closed)
      throw new PlatformIOError(
        "Debugger preparation owner disconnected.",
        "DEBUG_CLIENT_CLOSED",
      );
    const { args, key } = await this.identity(input, caller);
    for (const [identity, entry] of this.entries)
      if (!entry.busy && entry.expires <= Date.now())
        this.entries.delete(identity);
    let entry = this.entries.get(key);
    if (entry?.busy)
      throw new PlatformIOError(
        "Identical debugger preparation is already running.",
        "DEBUG_PREPARATION_BUSY",
      );
    if (!entry) {
      if (this.entries.size >= 8)
        throw new PlatformIOError(
          "Pending debugger preparations reached capacity.",
          "DEBUG_SESSION_LIMIT",
        );
      entry = {
        expires: Date.now() + 15 * 60 * 1000,
        guard: createPolicyRevisionGuard(args.projectDir),
        values: new Map(),
        busy: false,
      };
      this.entries.set(key, entry);
    }
    const retained = entry;
    const check = () => {
      if (this.closed)
        throw new PlatformIOError(
          "Debugger preparation owner disconnected.",
          "DEBUG_CLIENT_CLOSED",
        );
      if (Date.now() >= retained.expires)
        throw new PlatformIOError(
          "Debugger preparation expired.",
          "DEBUG_PREPARATION_EXPIRED",
        );
      retained.guard();
    };
    const checkpoint: DebugPreparationCheckpoint = {
      stage: async <T>(name: string, execute: () => Promise<T>): Promise<T> => {
        check();
        if (retained.values.has(name)) return retained.values.get(name) as T;
        const result = await execute();
        check();
        retained.values.set(name, result);
        return result;
      },
    };
    retained.busy = true;
    try {
      check();
      const result = await prepareDebuggerProject(
        args,
        caller,
        signal,
        checkpoint,
      );
      check();
      return result;
    } catch (error) {
      if (
        !(error instanceof PlatformIOError) ||
        error.code !== "APPROVAL_REQUIRED"
      )
        this.entries.delete(key);
      throw error;
    } finally {
      retained.busy = false;
    }
  }

  /** A completed startup ends this preparation; another startup must perform its own authorized preparation. */
  async forget(
    input: unknown,
    caller: PolicyEvaluationContext = {},
  ): Promise<void> {
    const { key } = await this.identity(input, caller);
    if (this.entries.get(key)?.busy)
      throw new PlatformIOError(
        "Preparation is still running.",
        "DEBUG_PREPARATION_BUSY",
      );
    this.entries.delete(key);
  }

  /** Drop read-only checkpoints on disconnect; in-flight work notices closure before continuing stages. */
  close(): void {
    this.closed = true;
    this.entries.clear();
  }

  private async identity(input: unknown, caller: PolicyEvaluationContext) {
    const args = parseDebugPreparationArguments(input);
    args.projectDir = await fs.realpath(args.projectDir);
    const key = createHash("sha256")
      .update(
        JSON.stringify({
          projectDir: args.projectDir,
          environment: args.environment,
          load: args.load,
          timeoutMs: args.timeoutMs,
          caller: { ...caller, workspaceDir: args.projectDir },
        }),
      )
      .digest("hex");
    return { args, key };
  }
}
