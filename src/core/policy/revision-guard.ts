/** Detects policy/enrollment changes between stages without reusing or consuming an approval twice. */
import { loadEffectivePolicyState } from "./load-policy.js";
import { PlatformIOError } from "../../utils/errors.js";

/**
 * Captures a policy revision, not an authorization grant. Each operation still needs authorization.
 * Invoke the returned check immediately before later effects and before returning sensitive results.
 */
export function createPolicyRevisionGuard(workspaceDir?: string): () => void {
  const expected = loadEffectivePolicyState(workspaceDir).digest;
  return () => {
    if (loadEffectivePolicyState(workspaceDir).digest !== expected)
      throw new PlatformIOError(
        "Policy or project enrollment changed during execution; start a new authorized operation.",
        "POLICY_CHANGED",
      );
  };
}
