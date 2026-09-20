/**
 * Shared operation authorization boundary.
 * Provides dispatchAuthorizedAction so adapters cannot execute callbacks before policy allows them.
 */
import { policyNamesForOperation, actionRiskLevels } from "./action-catalog.js";
import {
  evaluatePolicy,
  planPolicy,
  type PolicyPlan,
} from "./policy/evaluate-policy.js";
import type {
  PolicyDecision,
  PolicyEvaluationContext,
} from "./policy/types.js";
import { PlatformIOError } from "../utils/errors.js";

/**
 * Authorizes one implemented operation before invoking its adapter callback.
 * Approval scope retains the concrete operation identity for composite workflows.
 * @param name Implemented operation name, never an unvalidated arbitrary command.
 * @param args Operation arguments used by the execution adapter.
 * @param context Explicit workspace and caller scope.
 * @param execute Callback reached only after authorization succeeds.
 * @returns The adapter's unchanged result.
 */
export async function dispatchAuthorizedAction<T>(
  name: string,
  args: Record<string, unknown>,
  context: PolicyEvaluationContext,
  execute: () => Promise<T>,
): Promise<T> {
  const decision = await authorizeAction(name, args, context);
  if (decision.status !== "allow")
    throw new PlatformIOError(
      decision.reason,
      decision.status === "requires_approval"
        ? "APPROVAL_REQUIRED"
        : "POLICY_DENIED",
      { policyDecision: decision },
    );
  return execute();
}

/** Resolves shared policy identity while preserving the concrete operation in grant scope. */
export async function authorizeAction(
  name: string,
  args: Record<string, unknown>,
  context: PolicyEvaluationContext,
): Promise<PolicyDecision> {
  const action =
    name === "start_pio_home"
      ? "run_shell_command"
      : policyNamesForOperation(name).at(-1)!;
  if (!Object.hasOwn(actionRiskLevels, action))
    throw new PlatformIOError(`Unknown operation: ${name}`, "UNKNOWN_ACTION");
  return evaluatePolicy(action, args, {
    ...context,
    operationName: name,
  });
}

/** Inspect a concrete operation's approval readiness; callers must still dispatch before executing. */
export async function planAction(
  name: string,
  args: Record<string, unknown>,
  context: PolicyEvaluationContext,
): Promise<PolicyPlan> {
  const action =
    name === "start_pio_home"
      ? "run_shell_command"
      : policyNamesForOperation(name).at(-1)!;
  if (!Object.hasOwn(actionRiskLevels, action))
    throw new PlatformIOError(`Unknown operation: ${name}`, "UNKNOWN_ACTION");
  return planPolicy(action, args, { ...context, operationName: name });
}
