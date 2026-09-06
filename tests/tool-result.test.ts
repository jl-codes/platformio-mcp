/**
 * Structured MCP tool-result compatibility tests.
 */

import { describe, expect, it } from "vitest";
import { ensureStructuredToolResult } from "../src/mcp/tool-result.js";

describe("structured MCP tool results", () => {
  it("adds an envelope without changing legacy JSON text", () => {
    const response = {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: true, message: "Build complete." }),
        },
      ],
    };

    const structured = ensureStructuredToolResult("build_project", response);

    expect(structured.content).toEqual(response.content);
    expect(structured.structuredContent).toMatchObject({
      success: true,
      status: "completed",
      summary: "Build complete.",
      data: { success: true, message: "Build complete." },
    });
  });

  it("preserves a native structured result", () => {
    const existing = {
      content: [{ type: "text", text: "already structured" }],
      structuredContent: {
        success: false,
        status: "blocked" as const,
        summary: "Target is ambiguous.",
        observedAt: "2026-09-05T00:00:00.000Z",
      },
    };

    expect(ensureStructuredToolResult("agent_resolve_target", existing)).toBe(
      existing,
    );
  });
});
