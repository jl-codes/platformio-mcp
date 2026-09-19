/** Compact reference-style failures with bounded diagnostics and canonical approval metadata. */
import { z } from "zod";
import { redactSecretsInText } from "../core/policy/redact.js";

const decisionSchema = z.object({
  status: z.enum(["allow", "deny", "requires_approval"]),
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
    typeof record.code === "string" && /^[A-Z0-9_]{1,128}$/.test(record.code)
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
  const result = {
    ok: false as const,
    error: names[code] ?? code,
    summary: redactSecretsInText(
      typeof record.message === "string"
        ? record.message
        : "Compatibility operation failed.",
    ).slice(0, 8192),
    log_path: null,
    status:
      code === "APPROVAL_REQUIRED" ? ("blocked" as const) : ("failed" as const),
    details: { code, ...(policyDecision ? { policyDecision } : {}) },
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
