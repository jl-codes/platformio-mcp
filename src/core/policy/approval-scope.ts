/**
 * Approval scope identity.
 * Provides approvalScopeDigest to bind grants to exact arguments and policy identity.
 */
import crypto from "node:crypto";
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";
import type { PolicyEvaluationContext } from "./types.js";

/** Encodes JSON deterministically while rejecting values that cannot be bound safely. */
function canonical(value: unknown, depth = 0): string {
  if (depth > 32)
    throw new PlatformIOError(
      "Approval arguments exceed the nesting limit.",
      "APPROVAL_SCOPE_INVALID",
    );
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonical(item, depth + 1)).join(",")}]`;
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], depth + 1)}`,
      )
      .join(",")}}`;
  }
  throw new PlatformIOError(
    "Approval arguments must contain finite JSON values.",
    "APPROVAL_SCOPE_INVALID",
  );
}

/**
 * Hashes operation identity without persisting secrets from its arguments.
 * Only approval transport fields are excluded; nested operation data remains bound.
 * @param action Canonical policy action.
 * @param args Validated operation arguments.
 * @param policyDigest Identity of the effective policy and contributing sources.
 * @param context Execution scope resolved by the entrypoint.
 * @returns SHA-256 identity used for one-time grant consumption.
 */
export function approvalScopeDigest(
  action: string,
  args: Record<string, unknown>,
  policyDigest: string,
  context: PolicyEvaluationContext,
): string {
  const operation = { ...args };
  for (const key of ["approvalId", "approved", "__approved"])
    delete operation[key];
  if (typeof operation.projectDir === "string")
    operation.projectDir = path.resolve(operation.projectDir);
  const encoded = canonical({
    action,
    operationName: context.operationName ?? action,
    args: operation,
    policyDigest,
    workspaceDir: context.workspaceDir
      ? path.resolve(context.workspaceDir)
      : null,
    devicePort: context.devicePort ?? null,
    targetBindingDigest: context.targetBindingDigest ?? null,
    automationKey: context.automationKey ?? null,
    actorClass:
      context.actorClass ??
      (context.actor === "system" ? "system" : "interactive"),
  });
  if (Buffer.byteLength(encoded) > 256 * 1024)
    throw new PlatformIOError(
      "Approval arguments exceed the 256 KiB limit.",
      "APPROVAL_SCOPE_INVALID",
    );
  return crypto.createHash("sha256").update(encoded).digest("hex");
}
