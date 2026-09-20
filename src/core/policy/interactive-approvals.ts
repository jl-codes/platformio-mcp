/** Host-only CLI approval sessions preserve exact one-use grants across composite preflight and execution. */
import { AsyncLocalStorage } from "node:async_hooks";
import { approveRequest } from "./approvals.js";
import type { ApprovalRequest } from "./types.js";
import { PlatformIOError } from "../../utils/errors.js";

interface InteractiveApprovalScope {
  active: boolean;
  requests: number;
  grants: Map<string, string>;
  confirm: (request: ApprovalRequest) => Promise<boolean>;
}
const scopes = new AsyncLocalStorage<InteractiveApprovalScope>();

/** Enable only around an explicitly interactive CLI invocation; never expose this through tool arguments. */
export async function withInteractiveApprovals<T>(
  confirm: InteractiveApprovalScope["confirm"],
  execute: () => Promise<T>,
): Promise<T> {
  const scope: InteractiveApprovalScope = {
    active: true,
    requests: 0,
    grants: new Map(),
    confirm,
  };
  return scopes.run(scope, async () => {
    try {
      return await execute();
    } finally {
      scope.active = false;
      scope.grants.clear();
    }
  });
}

/** Look up only the exact scope; the policy evaluator still checks expiry, revision and consumption. */
export function interactiveApprovalId(scopeDigest: string): string | undefined {
  const scope = scopes.getStore();
  return scope?.active ? scope.grants.get(scopeDigest) : undefined;
}

/** Ask the local operator once at this boundary, then let policy reevaluate rather than granting execution here. */
export async function requestInteractiveApproval(
  request: ApprovalRequest,
): Promise<string | undefined> {
  const scope = scopes.getStore();
  if (!scope?.active || !request.scopeDigest) return undefined;
  if (++scope.requests > 32)
    throw new PlatformIOError(
      "Interactive approval limit reached.",
      "APPROVAL_REQUIRED",
    );
  if (!(await scope.confirm(request)))
    throw new PlatformIOError("Action cancelled by user.", "APPROVAL_DENIED");
  if (!scope.active || !approveRequest(request.id))
    throw new PlatformIOError(
      "Approval session is no longer available.",
      "APPROVAL_REQUIRED",
    );
  scope.grants.set(request.scopeDigest, request.id);
  return request.id;
}
