/**
 * MCP Tool Result Helpers
 *
 * Provides:
 * - createToolResult: Builds a stable structured and text result envelope.
 * - createToolErrorResult: Builds a structured MCP error response.
 * - ensureStructuredToolResult: Adds the envelope to legacy JSON-text results.
 */

import type { PolicyDecision } from "../core/policy/types.js";

/** Stable status values shared by PlatformIO MCP tools. */
export type ToolResultStatus =
  | "completed"
  | "running"
  | "cancelled"
  | "failed"
  | "blocked"
  | "unavailable";

/** Common structured result envelope exposed to MCP clients. */
export interface ToolResultEnvelope<TData = unknown> {
  success: boolean;
  status: ToolResultStatus;
  summary: string;
  data?: TData;
  diagnostics?: unknown[];
  nextSteps?: string[];
  taskId?: string;
  logPaths?: string[];
  observedAt: string;
  policyDecision?: PolicyDecision;
}

/** MCP-compatible response containing both legacy JSON text and structured data. */
export interface StructuredToolResult<TData = unknown> {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: ToolResultEnvelope<TData>;
  isError?: boolean;
}

/**
 * Builds a stable response while preserving JSON-in-text compatibility.
 *
 * @param input - Result fields, excluding the generated observation timestamp.
 * @returns MCP content and structuredContent with identical envelope data.
 */
export function createToolResult<TData>(
  input: Omit<ToolResultEnvelope<TData>, "observedAt"> & {
    observedAt?: string;
  },
): StructuredToolResult<TData> {
  const envelope: ToolResultEnvelope<TData> = {
    ...input,
    observedAt: input.observedAt ?? new Date().toISOString(),
  };

  return {
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    structuredContent: envelope,
  };
}

/**
 * Builds a stable error response with actionable next steps.
 *
 * @param summary - Concise explanation of the failure.
 * @param options - Optional data, diagnostics, and remediation details.
 * @returns MCP error response.
 */
export function createToolErrorResult<TData = unknown>(
  summary: string,
  options: {
    status?: Extract<ToolResultStatus, "failed" | "blocked" | "unavailable">;
    data?: TData;
    diagnostics?: unknown[];
    nextSteps?: string[];
    policyDecision?: PolicyDecision;
  } = {},
): StructuredToolResult<TData> {
  const result = createToolResult({
    success: false,
    status: options.status ?? "failed",
    summary,
    data: options.data,
    diagnostics: options.diagnostics,
    nextSteps: options.nextSteps,
    policyDecision: options.policyDecision,
  });

  return { ...result, isError: true };
}

/**
 * Adds structured content to a legacy MCP response while preserving its text.
 *
 * @param toolName - Public MCP tool name used in the fallback summary.
 * @param response - Existing response returned by a tool handler.
 * @returns Original content plus a stable structured result envelope.
 */
export function ensureStructuredToolResult<
  TResponse extends {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: ToolResultEnvelope;
    isError?: boolean;
  },
>(
  toolName: string,
  response: TResponse,
): TResponse & {
  structuredContent: ToolResultEnvelope;
} {
  if (response.structuredContent) {
    return response as TResponse & { structuredContent: ToolResultEnvelope };
  }

  const text = response.content?.find(
    (item) => item.type === "text" && typeof item.text === "string",
  )?.text;
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    // Plain-text legacy output remains available as structured data.
  }
  const record =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)
      : undefined;
  const success =
    typeof record?.success === "boolean"
      ? record.success
      : response.isError !== true;
  const rawStatus = record?.status;
  const statusValues: ToolResultStatus[] = [
    "completed",
    "running",
    "cancelled",
    "failed",
    "blocked",
    "unavailable",
  ];
  const status = statusValues.includes(rawStatus as ToolResultStatus)
    ? (rawStatus as ToolResultStatus)
    : success
      ? "completed"
      : "failed";
  const summary =
    typeof record?.summary === "string"
      ? record.summary
      : typeof record?.message === "string"
        ? record.message
        : `${toolName} ${success ? "completed" : "failed"}.`;

  return {
    ...response,
    structuredContent: {
      success,
      status,
      summary,
      data,
      observedAt: new Date().toISOString(),
    },
  };
}
