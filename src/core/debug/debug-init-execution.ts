/** Execute an exact retained initialization script only with both target and privileged host-code authority. */
import { PlatformIOError } from "../../utils/errors.js";
import { dispatchAuthorizedAction, planAction } from "../action-dispatcher.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import type { GdbMiSession } from "./gdb-mi-session.js";
import {
  assertDebugInitArtifact,
  type DebugInitArtifact,
} from "./debug-init-artifact.js";

/** Source command text remains private; approval scope uses stable content and startup identities, never a random staging path. */
export async function executeDebugInitialization(
  transport: GdbMiSession,
  artifact: DebugInitArtifact,
  input: {
    projectDir: string;
    sessionId: string;
    timeoutMs: number;
    hostApprovalId?: string;
    targetApprovalId?: string;
  },
  caller: PolicyEvaluationContext = {},
): Promise<void> {
  assertDebugInitArtifact(artifact);
  if (
    !input.sessionId ||
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > 600000
  )
    throw new PlatformIOError(
      "Invalid debugger initialization scope.",
      "DEBUG_INIT_INVALID",
    );
  const base = {
    projectDir: input.projectDir,
    sessionId: input.sessionId,
    scriptSha256: artifact.sha256,
    scriptBytes: artifact.size,
    ...artifact.binding,
    purpose: "debugger_initialization_script",
  };
  const context = { ...caller, workspaceDir: input.projectDir };
  const stages = [
    {
      action: "debugger_host_code",
      args: { ...base, approvalId: input.hostApprovalId },
    },
    {
      action: "debugger_mutate",
      args: { ...base, approvalId: input.targetApprovalId },
    },
  ];
  for (const stage of stages) {
    const plan = await planAction(stage.action, stage.args, context);
    if (plan.status !== "ready")
      throw new PlatformIOError(
        plan.reason,
        plan.status === "requires_approval"
          ? "APPROVAL_REQUIRED"
          : "POLICY_DENIED",
        { policyDecision: plan },
      );
  }
  const guard = createPolicyRevisionGuard(input.projectDir);
  await dispatchAuthorizedAction(
    stages[0].action,
    stages[0].args,
    context,
    () =>
      dispatchAuthorizedAction(
        stages[1].action,
        stages[1].args,
        context,
        async () => {
          guard();
          await artifact.verify();
          guard();
          const deadline = performance.now() + input.timeoutMs;
          // GDB source treats the remaining argument as a filename, including spaces; quote only the MI string.
          const commands = [
            "-interpreter-exec console " +
              JSON.stringify(
                "source " +
                  (process.platform === "win32"
                    ? artifact.path.replace(/\\/g, "/")
                    : artifact.path),
              ),
            "-gdb-set auto-load off",
            "-gdb-set may-call-functions off",
          ];
          try {
            for (const command of commands) {
              const remaining = Math.floor(deadline - performance.now());
              if (remaining < 1)
                throw new PlatformIOError(
                  "Debugger initialization timed out.",
                  "DEBUG_INIT_TIMEOUT",
                );
              const result = await transport.execute(command, remaining);
              guard();
              if (
                result.timedOut ||
                result.closed ||
                result.result?.class !== "done"
              )
                throw new PlatformIOError(
                  "Debugger initialization script failed.",
                  "DEBUG_INIT_FAILED",
                );
            }
          } catch (error) {
            transport.invalidate(error);
            throw error;
          }
        },
      ),
  );
}
