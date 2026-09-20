/** Connection-owned reference debugger startup and session dispatch composition. */
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { DebugClientSessions } from "../core/debug/debug-client-sessions.js";
import { DebugPreparationCache } from "../core/debug/debug-preparation-cache.js";
import { startLocalPreparedDebugger } from "../core/debug/debug-local-startup.js";
import { withDebugProbeDiscovery } from "../core/devices/debug-probe-discovery.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { PlatformIOError } from "../utils/errors.js";
import {
  resolveCompatibilityProject,
  type CompatibilityProjectDefaults,
} from "./compatibility-project.js";
import {
  executeDebugSessionCompatibility,
  normalizeDebuggerStop,
} from "./debug-session-compat.js";

const approval = z.string().min(1).max(256).optional();
/** Request data narrows discovery; executable roots and cleanup authority remain host-owned. */
export const DebugStartCompatibilitySchema = z
  .object({
    project_dir: z.string().min(1).max(32768).nullish(),
    env: z
      .string()
      .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,49}$/)
      .nullish(),
    load: z.boolean().default(true),
    timeout_s: z.number().finite().min(0.001).max(600).default(90),
    probe: z
      .object({
        vendor_id: z
          .string()
          .regex(/^(?:0x)?[a-f0-9]{4}$/i)
          .optional(),
        product_id: z
          .string()
          .regex(/^(?:0x)?[a-f0-9]{4}$/i)
          .optional(),
        serial_number: z
          .string()
          .min(1)
          .max(256)
          .regex(/^[^\x00-\x1f\x7f]+$/)
          .optional(),
      })
      .strict()
      .optional(),
    config_approval_id: approval,
    build_approval_id: approval,
    system_approval_id: approval,
    resolution_approval_id: approval,
    image_approval_id: approval,
    discovery_approval_id: approval,
    approval_id: approval,
    initialization_host_approval_id: approval,
    initialization_target_approval_id: approval,
    backend_host_approval_id: approval,
    backend_target_approval_id: approval,
  })
  .strict();

/** Instantiate once per authenticated connection; never share sessions or approval checkpoints globally. */
export class DebugCompatibilityClient {
  private readonly taskId = randomUUID();
  private readonly sessions = new DebugClientSessions();
  private readonly preparation = new DebugPreparationCache();
  private readonly abort = new AbortController();
  private readonly pending = new Set<Promise<unknown>>();

  /** Optional host verification supplements mandatory native supervisor proofs; never request-controlled. */
  constructor(private readonly confirmProbeReleased?: () => Promise<boolean>) {}

  /** Prepare once across approvals, then select and revalidate the physical probe during owned startup. */
  async start(
    input: unknown,
    defaults: CompatibilityProjectDefaults = {},
    caller: PolicyEvaluationContext = {},
  ) {
    if (this.abort.signal.aborted)
      throw new PlatformIOError(
        "Debugger client disconnected.",
        "DEBUG_CLIENT_CLOSED",
      );
    const parsed = DebugStartCompatibilitySchema.safeParse(input);
    if (!parsed.success)
      throw new PlatformIOError(
        "Invalid debugger startup arguments.",
        "COMPAT_ARGUMENT_INVALID",
      );
    const args = parsed.data;
    // MCP activity IDs change on approval retries; checkpoint ownership is this connection.
    caller = { ...caller, taskId: this.taskId };
    const operation = (async () => {
      const deadline = performance.now() + args.timeout_s * 1000;
      const projectDir = await resolveCompatibilityProject(
        args.project_dir,
        defaults,
      );
      const preparation = {
        projectDir,
        environment: args.env ?? undefined,
        load: args.load,
        timeoutMs: Math.ceil(args.timeout_s * 1000),
        configApprovalId: args.config_approval_id,
        buildApprovalId: args.build_approval_id,
        systemApprovalId: args.system_approval_id,
        resolutionApprovalId: args.resolution_approval_id,
        imageApprovalId: args.image_approval_id,
      };
      const prepared = await this.preparation.prepare(
        preparation,
        caller,
        this.abort.signal,
      );
      const remaining = Math.floor(deadline - performance.now());
      if (remaining < 1)
        throw new PlatformIOError(
          "Debugger startup deadline expired.",
          "DEBUG_START_TIMEOUT",
        );
      const id = await withDebugProbeDiscovery(
        projectDir,
        args.discovery_approval_id,
        caller,
        (readInventory) =>
          startLocalPreparedDebugger(
            this.sessions,
            {
              prepared,
              readInventory: async () => {
                const inventory = await readInventory();
                // Unidentified peripherals are not probe candidates. The selected probe must
                // still have a unique serial/location and be revalidated at handoff.
                return inventory.devices;
              },
              confirmProbeReleased: this.confirmProbeReleased,
              selector: args.probe
                ? {
                    vendorId: args.probe.vendor_id,
                    productId: args.probe.product_id,
                    serialNumber: args.probe.serial_number,
                  }
                : undefined,
              timeoutMs: preparation.timeoutMs,
              deadline,
              approvalId: args.approval_id,
              initializationHostApprovalId:
                args.initialization_host_approval_id,
              initializationTargetApprovalId:
                args.initialization_target_approval_id,
              backendHostApprovalId: args.backend_host_approval_id,
              backendTargetApprovalId: args.backend_target_approval_id,
            },
            caller,
          ),
      );
      // Forgetting is bookkeeping: a failure must not hide an already-owned session ID.
      await this.preparation.forget(preparation, caller).catch(() => {});
      const state = this.sessions
        .list()
        .find((session) => session.session_id === id);
      return {
        ok: true,
        session_id: id,
        project_dir: prepared.projectDir,
        env: prepared.environment,
        load: prepared.load,
        debug_tool:
          state?.debug_tool ?? prepared.configuration?.debugTool ?? null,
        uptime_s: state?.uptime_s ?? null,
        command: state?.command ?? null,
        init_script: state?.init_script ?? null,
        gdb_version: state?.gdb_version ?? null,
        stopped: normalizeDebuggerStop(state?.lastStop),
        running: state?.running ?? null,
        closed: state?.closed ?? null,
        summary:
          "Debugger initialized using the retained PlatformIO script; reported target state reflects the latest observed event.",
      };
    })();
    this.pending.add(operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(operation);
    }
  }

  /** Resolve policy scope from this connection's owned session, never a request-provided project. */
  projectForSession(id: string): string {
    const session = this.sessions
      .list()
      .find((entry) => entry.session_id === id);
    if (!session)
      throw new PlatformIOError(
        "Owned debugger session not found.",
        "DEBUG_SESSION_NOT_FOUND",
      );
    return session.project_dir;
  }

  /** Route commands through the same connection owner used by startup. */
  execute(
    name: "pio_debug_cmd" | "pio_debug_list" | "pio_debug_stop",
    input: unknown,
    caller: PolicyEvaluationContext = {},
  ) {
    return executeDebugSessionCompatibility(name, input, this.sessions, caller);
  }

  /** Cancel preparation, close session admission immediately, and retain uncertain cleanup for retry. */
  async close() {
    this.abort.abort();
    this.preparation.close();
    const cleanup = this.sessions.close();
    await Promise.allSettled([...this.pending]);
    await cleanup;
    return this.sessions.close();
  }
}
