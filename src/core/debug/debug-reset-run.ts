/** Invoke the configured PlatformIO reset/run hook only with both target and privileged-code authority. */
import { PlatformIOError } from "../../utils/errors.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import type { OwnedDebugProcess } from "./debug-client-sessions.js";

/** A hook acknowledgment is not independent physical proof that the target remains running. */
export async function resetRunDebuggerTarget(
  process: OwnedDebugProcess,
  input: {
    projectDir: string;
    sessionId: string;
    timeoutMs: number;
    hostApprovalId?: string;
    targetApprovalId?: string;
  },
  caller: PolicyEvaluationContext = {},
) {
  if (
    !input.sessionId ||
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > 600000
  )
    throw new PlatformIOError(
      "Invalid debugger reset/run scope.",
      "DEBUG_ARGUMENT_INVALID",
    );
  const command = "pio_reset_run_target";
  const context = { ...caller, workspaceDir: input.projectDir };
  const guard = createPolicyRevisionGuard(input.projectDir);
  guard();
  const result = await process.command(command, context, input.timeoutMs, {
    sessionId: input.sessionId,
    approvalId: input.hostApprovalId,
    targetApprovalId: input.targetApprovalId,
  });
  guard();
  if (
    result.closed ||
    result.timedOut ||
    !["done", "running"].includes(result.result?.class ?? "")
  )
    throw new PlatformIOError(
      "Debugger did not acknowledge its reset/run hook; session retained for recovery.",
      "DEBUG_RESET_RUN_FAILED",
      { sessionId: input.sessionId, targetStateUncertain: true },
    );
}
