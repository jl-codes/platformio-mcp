/** Compact error contracts must preserve denial/approval semantics without disclosing unrelated context. */
import { expect, it } from "vitest";
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
