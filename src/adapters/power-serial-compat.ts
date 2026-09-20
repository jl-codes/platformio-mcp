/** Compose reference serial power parameters with owned collection, fresh triggers and explicit measurement qualifiers. */
import { z } from "zod";
import {
  MonitorStartCompatibilitySchema,
  resolveMonitorRequest,
} from "./monitor-start-compat.js";
import type { SerialClientContext } from "./serial-client.js";
import type { CompatibilityProjectDefaults } from "./compatibility-project.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import {
  validatePowerCapture,
  type captureSessionPower,
} from "../core/serial/power-capture.js";
import { PlatformIOError } from "../utils/errors.js";

/** Serial branch only; source mode and PPK2 execution belong to the separately authorized meter adapter. */
export const SerialPowerCompatibilitySchema =
  MonitorStartCompatibilitySchema.extend({
    source: z.literal("serial").default("serial"),
    baud: z.number().int().min(1).max(4000000).default(115200),
    max_lines: z.number().int().min(1).max(10000).default(10000),
    seconds: z.number().finite().positive().max(600).default(10),
    pattern: z.string().max(4096).nullable().optional(),
    voltage_mv: z.number().finite().positive().max(1e9).nullable().optional(),
    buckets: z.number().int().min(0).max(1000).default(20),
    sleep_threshold_ma: z
      .number()
      .finite()
      .min(-1e9)
      .max(1e9)
      .nullable()
      .optional(),
    provenance: z
      .enum(["firmware_estimate", "external_meter", "unspecified_serial"])
      .default("unspecified_serial"),
    trigger: z.string().min(1).max(4096).nullable().optional(),
    trigger_session_id: z.string().min(1).max(256).nullable().optional(),
    trigger_seconds: z.number().finite().positive().max(600).default(10),
    trigger_approval_id: z.string().max(256).optional(),
    read_approval_id: z.string().max(256).optional(),
  }).superRefine((input, context) => {
    if (!!input.trigger !== !!input.trigger_session_id)
      context.addIssue({
        code: "custom",
        message: "trigger and trigger_session_id must be supplied together.",
      });
  });

/** Preserve reference result keys while exposing actual observation timing, provenance and incomplete collection. */
export function projectSerialPowerCompatibility(
  report: Omit<Awaited<ReturnType<typeof captureSessionPower>>, "state">,
  source: {
    port: string;
    baud: number;
    seconds: number;
    sessionId: string | null;
    cleanupPending?: boolean;
  },
) {
  const complete = report.collectionComplete && !source.cleanupPending;
  return {
    ...report.analysis,
    ok: report.ok && !source.cleanupPending,
    summary: report.summary,
    source: "serial" as const,
    port: source.port,
    baud: source.baud,
    seconds: source.seconds,
    session_id: source.sessionId,
    sample_count: report.analysis?.sample_count ?? 0,
    unparsed_lines: report.unparsedLines,
    line_count: report.lineCount,
    collection_duration_s: report.collectionDurationSeconds,
    timing_basis: report.timingBasis,
    voltage_source: report.voltageSource,
    collection_complete: complete,
    cleanup_pending: source.cleanupPending ?? false,
    cancelled: report.cancelled,
    limit_reached: report.limitReached,
    dropped_lines: report.droppedLines,
    truncated_bytes: report.truncatedBytes,
    partial_line_omitted: report.partialLineOmitted,
    redaction_applied: report.redactionApplied,
    redaction_output_may_be_truncated: report.redactionOutputMayBeTruncated,
    port_error: report.portError,
    ...(!report.analysis ? { error: "No current readings captured." } : {}),
  };
}

/** Wait for fresh owned firmware output before opening a meter; retain the firmware trigger session and close the one-shot meter session. */
export async function executeSerialPowerCompatibility(
  client: SerialClientContext,
  input: unknown,
  defaults: CompatibilityProjectDefaults,
  caller: PolicyEvaluationContext,
  projectDevices: Parameters<typeof resolveMonitorRequest>[3],
  signal?: AbortSignal,
) {
  const params = SerialPowerCompatibilitySchema.parse(input);
  const capture = await validatePowerCapture({
    seconds: params.seconds,
    maxLines: params.max_lines,
    pattern: params.pattern ?? undefined,
    voltageMv: params.voltage_mv ?? undefined,
    buckets: params.buckets,
    sleepThresholdMa: params.sleep_threshold_ma ?? undefined,
    provenance: params.provenance,
  });
  if (signal?.aborted)
    throw new PlatformIOError(
      "Power collection cancelled before startup.",
      "SERIAL_CANCELLED",
    );
  const trigger =
    params.trigger && params.trigger_session_id
      ? await client.run(
          { caller, readApprovalId: params.trigger_approval_id },
          (service, owner) =>
            service.waitPowerTrigger(
              owner,
              params.trigger_session_id!,
              { trigger: params.trigger!, seconds: params.trigger_seconds },
              signal,
            ),
        )
      : {};
  const { request } = await resolveMonitorRequest(
    {
      port: params.port,
      baud: params.baud,
      project_dir: params.project_dir,
      env: params.env,
      max_lines: params.max_lines,
      approval_id: params.approval_id,
      config_approval_id: params.config_approval_id,
      selection_approval_id: params.selection_approval_id,
      discovery_approval_id: params.discovery_approval_id,
    },
    defaults,
    caller,
    projectDevices,
  );
  return client.run(
    {
      caller,
      approvalId: params.approval_id,
      readApprovalId: params.read_approval_id,
      discoveryApprovalId: params.discovery_approval_id,
    },
    async (service, owner) => {
      const report = await service.capturePowerOnce(
        owner,
        request,
        capture,
        signal,
      );
      return {
        ...projectSerialPowerCompatibility(report, {
          port: report.port,
          baud: report.baud,
          seconds: params.seconds,
          sessionId: report.cleanupPending ? report.sessionId : null,
          cleanupPending: report.cleanupPending,
        }),
        ...trigger,
      };
    },
  );
}
