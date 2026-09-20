/** Public memory-watch compatibility backed by authorized bounded serial telemetry collection. */
import { z } from "zod";
import {
  MonitorStartCompatibilitySchema,
  resolveMonitorRequest,
} from "./monitor-start-compat.js";
import type { SerialClientContext } from "./serial-client.js";
import type { CompatibilityProjectDefaults } from "./compatibility-project.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import type { captureSessionMemory } from "../core/serial/memory-capture.js";
import { PlatformIOError } from "../utils/errors.js";

/** Preserve reference names while exposing explicit unit and loss qualifiers required by the safety contract. */
export function projectMemoryCompatibility(
  report: Omit<Awaited<ReturnType<typeof captureSessionMemory>>, "state">,
  source: {
    port: string;
    baud: number;
    sessionId: string | null;
    cleanupPending?: boolean;
  },
) {
  const fragmentation = report.fragmentation;
  return {
    ok: report.ok && !source.cleanupPending,
    summary: report.summary,
    port: source.port,
    baud: source.baud,
    session_id: source.sessionId,
    duration_s: report.durationSeconds,
    line_count: report.lineCount,
    port_error: report.portError,
    recognized: report.recognized,
    formats: report.formats,
    sample_count: report.sampleCount,
    metrics: Object.fromEntries(
      Object.entries(report.metrics).map(([name, value]) => [
        name,
        {
          metric: name,
          samples: value.samples,
          first: value.first,
          last: value.last,
          min: value.min,
          max: value.max,
          change: value.fittedChange,
          bytes_per_sample: value.bytesPerSample,
          bytes_per_second: value.bytesPerSecond,
          verdict: value.verdict,
          leak_suspected: value.leakSuspected,
          evidence: value.evidence,
        },
      ]),
    ),
    stacks: report.stacks.map((row) => ({
      task: row.task,
      stack_free_bytes: row.stackFreeBytes,
      samples: row.samples,
      last: row.lastBytes,
      warning: row.warning,
      unknown_unit_samples: row.unknownUnitSamples,
    })),
    fragmentation: fragmentation?.available
      ? {
          ratio: fragmentation.ratio,
          fragmented: fragmentation.fragmented,
          free_heap: fragmentation.freeHeap,
          largest_free_block: fragmentation.largestFreeBlock,
          evidence: fragmentation.evidence,
        }
      : null,
    samples: report.samples,
    samples_truncated: report.samplesTruncated,
    collection_complete: report.collectionComplete && !source.cleanupPending,
    cleanup_pending: source.cleanupPending ?? false,
    dropped_lines: report.droppedLines,
    truncated_bytes: report.truncatedBytes,
    unknown_unit_samples: report.unknownUnitSamples,
    ...(!report.recognized
      ? {
          instrumentation_hint: {
            arduino_esp32:
              'Serial.printf("mem=%u\\n", (unsigned)ESP.getFreeHeap());',
            esp_idf:
              'ESP_LOGI("memory", "mem=%u", (unsigned)heap_caps_get_free_size(MALLOC_CAP_8BIT));',
            freertos:
              "Print task stack high-water marks with their explicit byte/word unit; supply stack_word_bytes when reporting words.",
            custom:
              "For mem=1234 byte values, pass pattern: mem=(?P<value>\\d+).",
          },
        }
      : {}),
  };
}

/** Read an existing owned session or preauthorize opening/reading and clean up a one-shot session. */
export const MemoryWatchCompatibilitySchema =
  MonitorStartCompatibilitySchema.extend({
    session_id: z.string().min(1).max(256).nullable().optional(),
    seconds: z.number().finite().default(15),
    pattern: z.string().max(4096).nullable().optional(),
    stack_warn_bytes: z
      .number()
      .int()
      .min(0)
      .max(1024 * 1024 * 1024)
      .default(512),
    stack_unit: z.enum(["bytes", "words"]).optional(),
    stack_word_bytes: z.number().int().min(1).max(16).optional(),
    read_approval_id: z.string().max(256).optional(),
  });

/** Collect bounded memory telemetry through the shared owned-session service. */
export async function executeMemoryCompatibility(
  client: SerialClientContext,
  input: unknown,
  defaults: CompatibilityProjectDefaults,
  caller: PolicyEvaluationContext,
  projectDevices: Parameters<typeof resolveMonitorRequest>[3],
) {
  const params = MemoryWatchCompatibilitySchema.parse(input);
  if (params.stack_unit === "words" && params.stack_word_bytes === undefined)
    throw new PlatformIOError(
      "Word-valued stack telemetry requires stack_word_bytes.",
      "MEMORY_UNIT_REQUIRED",
    );
  const {
    session_id,
    seconds,
    pattern,
    stack_warn_bytes,
    stack_unit,
    stack_word_bytes,
    read_approval_id,
    ...start
  } = params;
  const options = {
    seconds: Math.max(0, Math.min(seconds, 300)),
    pattern: pattern ?? undefined,
    stackWarnBytes: stack_warn_bytes,
    stackUnit: stack_unit,
    stackWordBytes: stack_word_bytes,
    maxLines: params.max_lines,
  };
  if (session_id) {
    return client.run(
      {
        caller,
        approvalId: params.approval_id,
        readApprovalId: read_approval_id,
      },
      async (service, owner) => {
        const report = await service.captureMemory(owner, session_id, options);
        const session = service.sessions
          .list(owner)
          .find((item) => item.sessionId === session_id);
        if (!session)
          throw new PlatformIOError(
            "Owned memory session is no longer available.",
            "SERIAL_SESSION_NOT_FOUND",
          );
        return projectMemoryCompatibility(report, {
          port: session.path,
          baud: session.baudRate,
          sessionId: session_id,
        });
      },
    );
  }
  const { request } = await resolveMonitorRequest(
    start,
    defaults,
    caller,
    projectDevices,
  );
  return client.run(
    {
      caller,
      approvalId: params.approval_id,
      readApprovalId: read_approval_id,
      discoveryApprovalId: params.discovery_approval_id,
    },
    async (service, owner) => {
      const report = await service.captureMemoryOnce(owner, request, options);
      return projectMemoryCompatibility(report, {
        port: report.port,
        baud: report.baud,
        sessionId: report.cleanupPending ? report.sessionId : null,
        cleanupPending: report.cleanupPending,
      });
    },
  );
}
