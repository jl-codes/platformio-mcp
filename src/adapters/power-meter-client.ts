/** Compose connection-owned PPK2 discovery, permissions, process cleanup and power reports. */
import type { SerialPowerHold } from "../core/serial/session-manager.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PlatformIOError } from "../utils/errors.js";
import {
  resolveCompatibilityProject,
  type CompatibilityProjectDefaults,
} from "./compatibility-project.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { resolvePpk2Environment } from "../core/power/ppk2-environment.js";
import {
  bindPowerSerialDevice,
  withPowerSerialDiscovery,
} from "../core/power/power-serial-discovery.js";
import { AuthorizedPpk2Operation } from "../core/power/authorized-ppk2.js";
import { projectPpk2PowerReport } from "../core/power/ppk2-report.js";

/** Electrical settings and DUT binding are explicit; no supplied voltage silently selects source mode. */
export const Ppk2CompatibilitySchema = z
  .object({
    source: z.literal("ppk2"),
    project_dir: z.string().min(1).max(32768).nullable().optional(),
    port: z.string().min(1).max(512),
    dut_port: z.string().min(1).max(512),
    mode: z.enum(["ampere", "source"]),
    voltage_mv: z.number().int().min(800).max(5000),
    current_limit_ma: z.number().finite().positive().max(1000),
    seconds: z.number().finite().positive().max(600).default(10),
    buckets: z.number().int().min(0).max(1000).default(20),
    sleep_threshold_ma: z
      .number()
      .finite()
      .min(-1e9)
      .max(1e9)
      .nullable()
      .optional(),
    trigger: z.string().min(1).max(4096).nullable().optional(),
    trigger_session_id: z.string().min(1).max(256).nullable().optional(),
    trigger_seconds: z.number().finite().positive().max(600).default(10),
    trigger_approval_id: z.string().max(256).optional(),
    discovery_approval_id: z.string().max(256).optional(),
    host_approval_id: z.string().max(256).optional(),
    power_approval_id: z.string().max(256).optional(),
  })
  .strict()
  .refine((input) => input.mode !== "source" || input.current_limit_ma <= 600)
  .refine(
    (input) => !!input.trigger === !!input.trigger_session_id,
    "trigger and trigger_session_id must be supplied together.",
  );

/** One instance belongs to one authenticated connection; opaque cleanup IDs never cross connection ownership. */
export class PowerMeterClient {
  private closed = false;
  private readonly abort = new AbortController();
  private readonly owners = new Map<string, AuthorizedPpk2Operation>();
  private readonly pending = new Set<Promise<unknown>>();

  /** Profile a bound meter/DUT pair and retain failed cleanup under an opaque recovery ID. */
  async run(
    input: unknown,
    defaults: CompatibilityProjectDefaults,
    caller: PolicyEvaluationContext,
    dutHold?: SerialPowerHold,
    guard: () => void = () => {},
  ) {
    let transferred = false;
    try {
      this.assertOpen();
      guard();
      if (this.pending.size + this.owners.size >= 8)
        throw new PlatformIOError(
          "Power operation capacity reached; resolve pending cleanup first.",
          "POWER_CAPACITY",
        );
      const params = Ppk2CompatibilitySchema.parse(input);
      if (!!params.trigger !== !!dutHold)
        throw new PlatformIOError(
          "PPK2 triggers require an owned monitor hold.",
          "POWER_TRIGGER_REQUIRED",
        );
      const task = this.execute(
        params,
        defaults,
        caller,
        dutHold,
        () => {
          transferred = true;
        },
        guard,
      );
      this.pending.add(task);
      try {
        return await task;
      } finally {
        this.pending.delete(task);
      }
    } finally {
      // Before an operation owner is retained, no meter process can exist; return the unused hold.
      if (!transferred) dutHold?.releaseAfterExit();
    }
  }

  private assertOpen() {
    if (this.closed)
      throw new PlatformIOError(
        "Power client disconnected.",
        "POWER_CLIENT_CLOSED",
      );
  }

  private async execute(
    params: z.infer<typeof Ppk2CompatibilitySchema>,
    defaults: CompatibilityProjectDefaults,
    caller: PolicyEvaluationContext,
    dutHold: SerialPowerHold | undefined,
    onOwnership: () => void,
    guard: () => void,
  ) {
    const projectDir = await resolveCompatibilityProject(
      params.project_dir,
      defaults,
    );
    guard();
    if (dutHold && dutHold.projectDir !== projectDir)
      throw new PlatformIOError(
        "Trigger monitor belongs to a different project.",
        "POWER_DUT_SCOPE_MISMATCH",
      );
    this.assertOpen();
    const runtime = await resolvePpk2Environment(projectDir);
    this.assertOpen();
    guard();
    return withPowerSerialDiscovery(
      {
        projectDir,
        meterPort: params.port,
        dutPort: params.dut_port,
        approvalId: params.discovery_approval_id,
      },
      caller,
      async (read) => {
        const records = await read();
        this.assertOpen();
        guard();
        const meter = bindPowerSerialDevice(params.port, records, read);
        const dut = bindPowerSerialDevice(params.dut_port, records, read);
        const request = {
          port: meter.port,
          mode: params.mode,
          voltageMv: params.voltage_mv,
          currentLimitMa: params.current_limit_ma,
          seconds: params.seconds,
        };
        const operation = new AuthorizedPpk2Operation(
          {
            projectDir,
            pythonExecutable: runtime.pythonExecutable,
            request,
            meter: meter.custody,
            dut: dut.custody,
            dutHold,
            guard,
            hostApprovalId: params.host_approval_id,
            powerApprovalId: params.power_approval_id,
          },
          caller,
        );
        const id = randomUUID();
        this.owners.set(id, operation);
        onOwnership();
        try {
          const report = await operation.collect(this.abort.signal);
          guard();
          this.assertOpen();
          return {
            ...projectPpk2PowerReport(report, request, {
              buckets: params.buckets,
              sleepThresholdMa: params.sleep_threshold_ma ?? undefined,
            }),
            dut_port: dut.port,
          };
        } catch (error) {
          // Authorization may fail before collect enters its process-finally; inert owners also need disposal.
          await operation.cleanupProcess().catch(() => {});
          if (operation.state().cleanupPending)
            throw new PlatformIOError(
              error instanceof Error
                ? error.message
                : "Power operation failed.",
              error instanceof PlatformIOError
                ? error.code
                : "POWER_CAPTURE_FAILED",
              {
                ...(error instanceof PlatformIOError ? error.context : {}),
                cleanupPending: true,
                powerOperationId: id,
                powerMayBeOn: operation.state().powerMayBeOn,
              },
            );
          throw error;
        } finally {
          if (!operation.state().cleanupPending) this.owners.delete(id);
        }
      },
    );
  }

  /** List only this connection's retained owners; never reveal executable paths or custody capabilities. */
  list() {
    return [...this.owners].map(([id, operation]) => ({
      power_operation_id: id,
      ...operation.state(),
    }));
  }

  /** Retry shutdown without another power grant; an unrelated connection cannot address this owner. */
  async cleanup(id: string) {
    const operation = this.owners.get(id);
    if (!operation)
      throw new PlatformIOError(
        "Owned power operation not found.",
        "POWER_OPERATION_NOT_FOUND",
      );
    await operation.cleanupProcess();
    if (!operation.state().cleanupPending) this.owners.delete(id);
    return operation.state();
  }

  /** Cancel work on disconnect, wait for startup/collection to settle, then retry every retained cleanup. */
  async close() {
    this.closed = true;
    this.abort.abort();
    await Promise.allSettled([...this.pending]);
    await Promise.allSettled(
      [...this.owners.keys()].map((id) => this.cleanup(id)),
    );
    if (this.owners.size)
      throw new PlatformIOError(
        "Power device cleanup remains unconfirmed.",
        "PPK2_CLEANUP_PENDING",
        { cleanupPending: true, operations: this.list() },
      );
  }
}
