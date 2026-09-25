/** Compact error contracts must preserve denial/approval semantics without disclosing unrelated context. */
import { expect, it } from "vitest";
import { z } from "zod";
import { compatibilityErrorResult } from "../src/adapters/compatibility-error.js";
import {
  PlatformIOError,
  PlatformIONotInstalledError,
} from "../src/utils/errors.js";

it.each([
  ["POLICY_DENIED", "policy_denied"],
  ["APPROVAL_REQUIRED", "approval_required"],
  ["ENOENT", "not_found"],
  ["COMPAT_ARGUMENT_INVALID", "ValueError"],
])("maps %s without claiming success", (code, mapped) => {
  const result = compatibilityErrorResult(new PlatformIOError("failed", code));
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    ok: false,
    error: mapped,
    details: { code },
    status: code === "APPROVAL_REQUIRED" ? "blocked" : "failed",
  });
  expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
});
it("preserves scoped approval identity and filters arbitrary exception context", () => {
  const result = compatibilityErrorResult(
    new PlatformIOError("approval needed", "APPROVAL_REQUIRED", {
      request: "private-request",
      policyDecision: {
        status: "requires_approval",
        reason: "approval needed",
        action: "install_library",
        riskLevel: "medium",
        timestamp: "2026-09-19",
        approvalId: "scoped-id",
        extra: "private-extra",
      },
    }),
  );
  expect(result.structuredContent).toMatchObject({
    approval_id: "scoped-id",
    details: { policyDecision: { approvalId: "scoped-id" } },
  });
  expect(JSON.stringify(result)).not.toContain("private-");
});
it("bounds and redacts diagnostics and maps absent PlatformIO", () => {
  const result = compatibilityErrorResult(
    new Error("password=private-value " + "x".repeat(10000)),
  );
  expect(result.structuredContent.summary.length).toBeLessThanOrEqual(8192);
  expect(JSON.stringify(result)).not.toContain("private-value");
  expect(
    compatibilityErrorResult(new PlatformIONotInstalledError())
      .structuredContent.error,
  ).toBe("pio_not_found");
});

it("returns a bounded upload resume reference without exposing private execution context", () => {
  const resumeId = "a466f2da-7160-4a31-a197-1d0f4229a07d";
  const result = compatibilityErrorResult(
    new PlatformIOError("Approve retained firmware", "APPROVAL_REQUIRED", {
      resumeId,
      manifestSha256: "a".repeat(64),
      custody: "private-custody",
    }),
  );
  expect(result.structuredContent).toMatchObject({
    resume_id: resumeId,
    manifest_sha256: "a".repeat(64),
  });
  expect(JSON.stringify(result)).not.toContain("private-custody");
});

it("preserves both preflight grants without copying arbitrary context", () => {
  const decision = {
    status: "requires_approval",
    reason: "password=private-value",
    action: "serial_session_start",
    riskLevel: "medium",
    timestamp: "2026-09-20",
    approvalId: "opening",
    extra: "private-extra",
  };
  const result = compatibilityErrorResult(
    new PlatformIOError("preflight", "APPROVAL_REQUIRED", {
      decisions: {
        opening: decision,
        reading: {
          ...decision,
          action: "serial_session_read",
          approvalId: "reading",
        },
        extra: "private-extra",
      },
    }),
  );
  expect(result.structuredContent).toMatchObject({
    details: {
      decisions: {
        opening: { approvalId: "opening" },
        reading: { approvalId: "reading" },
      },
    },
  });
  expect(JSON.stringify(result)).not.toContain("private-");
});

it("reports raw schema failures without echoing input values", () => {
  const parsed = z.enum(["permitted"]).safeParse("private-payload");
  expect(parsed.success).toBe(false);
  if (parsed.success) throw new Error("Expected schema rejection");
  const result = compatibilityErrorResult(parsed.error);
  expect(result.structuredContent).toMatchObject({
    error: "ValueError",
    details: { code: "COMPAT_ARGUMENT_INVALID" },
  });
  expect(JSON.stringify(result)).not.toContain("private-payload");
});

it("preserves cleanup ownership in a bounded debugger startup failure", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const result = compatibilityErrorResult(
    new PlatformIOError("Cleanup pending", "GDB_START_FAILED", {
      sessionId: id,
      cleanupPending: true,
      debuggerStart: {
        env: "debug",
        debug_tool: "openocd",
        output_tail: "probe failed",
      },
      unrelated: "do not copy",
    }),
  );
  expect(result.structuredContent).toMatchObject({
    error: "debug_exited",
    session_id: id,
    cleanup_pending: true,
    env: "debug",
    output_tail: "probe failed",
  });
  expect(JSON.stringify(result)).not.toContain("do not copy");
});
it("does not change unrelated canonical errors or accept malformed startup metadata", () => {
  for (const context of [
    {},
    {
      debuggerStart: {
        env: "debug",
        debug_tool: null,
        output_tail: "x".repeat(2501),
      },
    },
  ]) {
    const result = compatibilityErrorResult(
      new PlatformIOError("failed", "DEBUG_BUILD_FAILED", context),
    );
    expect(result.structuredContent.error).toBe("DEBUG_BUILD_FAILED");
    expect(result.structuredContent).not.toHaveProperty("output_tail");
  }
});
