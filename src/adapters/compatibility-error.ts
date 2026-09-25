/** Compact reference-style failures with bounded diagnostics and canonical approval metadata. */
import { z } from "zod";
import { redactSecretsInText } from "../core/policy/redact.js";

const decisionSchema = z.object({
  status: z.enum(["allow", "ready", "deny", "requires_approval"]),
  reason: z.string().max(8192),
  action: z.string().max(256),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  approvalId: z.string().max(256).optional(),
  timestamp: z.string().max(128),
});
/** Translate expected failures without copying exception context, stack traces, or request bodies. */
export function compatibilityErrorResult(error: unknown) {
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const code =
    error instanceof z.ZodError
      ? "COMPAT_ARGUMENT_INVALID"
      : typeof record.code === "string" &&
          /^[A-Z0-9_]{1,128}$/.test(record.code)
        ? record.code
        : "INTERNAL_ERROR";
  const names: Record<string, string> = {
    POLICY_DENIED: "policy_denied",
    APPROVAL_REQUIRED: "approval_required",
    PLATFORMIO_NOT_INSTALLED: "pio_not_found",
    ENOENT: "not_found",
    ENOTDIR: "not_found",
    COMPAT_ARGUMENT_INVALID: "ValueError",
    COMPAT_PROJECT_INVALID: "ValueError",
    BOARD_NOT_FOUND: "KeyError",
    GET_BOARD_INFO_FAILED: "RuntimeError",
    LIST_BOARDS_FAILED: "RuntimeError",
  };
  const context =
    record.context && typeof record.context === "object"
      ? (record.context as Record<string, unknown>)
      : {};
  const parsed = decisionSchema.safeParse(context.policyDecision);
  const policyDecision = parsed.success
    ? {
        ...parsed.data,
        reason: redactSecretsInText(parsed.data.reason).slice(0, 8192),
      }
    : undefined;
  const preflight = z
    .object({
      opening: decisionSchema,
      reading: decisionSchema,
    })
    .safeParse(context.decisions);
  const decisions = preflight.success
    ? Object.fromEntries(
        Object.entries(preflight.data).map(([key, value]) => [
          key,
          {
            ...value,
            reason: redactSecretsInText(value.reason).slice(0, 8192),
          },
        ]),
      )
    : undefined;
  const resume =
    code === "APPROVAL_REQUIRED"
      ? z
          .object({
            resumeId: z.string().uuid(),
            manifestSha256: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
          })
          .safeParse(context)
      : undefined;
  const debuggerStart = /^(?:DEBUG_|GDB_)/.test(code)
    ? z
        .object({
          env: z.string().max(50).nullable(),
          debug_tool: z.string().max(256).nullable(),
          output_tail: z.string().max(2500),
        })
        .strict()
        .safeParse(context.debuggerStart)
    : undefined;
  const debuggerNames: Record<string, string> = {
    DEBUG_BUILD_FAILED: "build_failed",
    DEBUG_ENVIRONMENT_INVALID: "bad_env",
    DEBUG_PROBE_NOT_FOUND: "probe_not_found",
    DEBUG_BACKEND_REQUIRED: "debug_tool_missing",
    DEBUG_PYTHON_UNAVAILABLE: "debug_tool_missing",
    DEBUG_PREPARATION_TIMEOUT: "start_timeout",
    DEBUG_START_TIMEOUT: "start_timeout",
    DEBUG_BACKEND_READY_TIMEOUT: "start_timeout",
    DEBUG_INIT_TIMEOUT: "start_timeout",
    GDB_INIT_TIMEOUT: "start_timeout",
    DEBUG_INIT_FAILED: "init_script_failed",
    GDB_INIT_FAILED: "init_script_failed",
    DEBUG_BACKEND_NOT_READY: "debug_exited",
    GDB_START_FAILED: "debug_exited",
  };
  const result = {
    ok: false as const,
    error:
      (debuggerStart?.success ? debuggerNames[code] : undefined) ??
      names[code] ??
      code,
    ...(debuggerStart?.success
      ? {
          ...debuggerStart.data,
          ...(typeof context.cleanupPending === "boolean"
            ? { cleanup_pending: context.cleanupPending }
            : {}),
          ...(z.string().uuid().safeParse(context.sessionId).success
            ? { session_id: context.sessionId as string }
            : {}),
          output_tail: redactSecretsInText(
            debuggerStart.data.output_tail,
          ).slice(-2500),
        }
      : {}),
    summary: redactSecretsInText(
      error instanceof z.ZodError
        ? "Compatibility arguments do not match the tool schema."
        : typeof record.message === "string"
          ? record.message
          : "Compatibility operation failed.",
    ).slice(0, 8192),
    log_path: null,
    ...(resume?.success
      ? {
          resume_id: resume.data.resumeId,
          ...(resume.data.manifestSha256
            ? { manifest_sha256: resume.data.manifestSha256 }
            : {}),
        }
      : {}),
    status:
      code === "APPROVAL_REQUIRED" ? ("blocked" as const) : ("failed" as const),
    details: {
      code,
      ...(policyDecision ? { policyDecision } : {}),
      ...(decisions ? { decisions } : {}),
    },
    ...(policyDecision?.approvalId
      ? { approval_id: policyDecision.approvalId }
      : {}),
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
    isError: true as const,
  };
}
