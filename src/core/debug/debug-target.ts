/** Authorized target attachment and optional image download over an already owned debugger transport. */
import { isIP } from "node:net";
import { PlatformIOError } from "../../utils/errors.js";
import { dispatchAuthorizedAction, planAction } from "../action-dispatcher.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import type { GdbMiSession } from "./gdb-mi-session.js";

/** Trusted startup selection; adapters must acquire matching probe/server custody before use. */
export interface DebugTargetSelection {
  projectDir: string;
  sessionId: string;
  host: string;
  port: number;
  load: boolean;
  elfSha256?: string;
  connectApprovalId?: string;
  loadApprovalId?: string;
  timeoutMs?: number;
}

/** Preflight all target effects before attachment; loading uses the retained ELF already selected in GDB. */
export async function preflightDebuggerTarget(
  selection: DebugTargetSelection,
  caller: PolicyEvaluationContext,
) {
  const timeoutMs = selection.timeoutMs ?? 90000;
  if (
    !isIP(selection.host) ||
    !Number.isInteger(selection.port) ||
    selection.port < 1 ||
    selection.port > 65535 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 600000 ||
    typeof selection.load !== "boolean" ||
    (selection.load && !selection.elfSha256) ||
    (selection.elfSha256 !== undefined &&
      !/^[a-f0-9]{64}$/i.test(selection.elfSha256)) ||
    !selection.sessionId
  )
    throw new PlatformIOError(
      "Invalid debugger target selection.",
      "DEBUG_TARGET_INVALID",
    );
  const endpoint =
    isIP(selection.host) === 6
      ? "[" + selection.host + "]:" + selection.port
      : selection.host + ":" + selection.port;
  const base = {
    projectDir: selection.projectDir,
    sessionId: selection.sessionId,
    endpoint,
    elfSha256: selection.elfSha256?.toLowerCase(),
  };
  const stages = [
    {
      ...base,
      effect: "connect",
      miCommand: "-target-select extended-remote " + endpoint,
      approvalId: selection.connectApprovalId,
    },
    ...(selection.load
      ? [
          {
            ...base,
            effect: "load",
            miCommand: "-target-download",
            approvalId: selection.loadApprovalId,
          },
        ]
      : []),
  ];
  const context = { ...caller, workspaceDir: selection.projectDir };
  for (const stage of stages) {
    const plan = await planAction("debugger_mutate", stage, context);
    if (plan.status !== "ready")
      throw new PlatformIOError(
        plan.reason,
        plan.status === "requires_approval"
          ? "APPROVAL_REQUIRED"
          : "POLICY_DENIED",
        { policyDecision: plan },
      );
  }
  return { stages, context, timeoutMs };
}

/** Attach and optionally load only after every requested target effect is authorized. */
export async function attachDebuggerTarget(
  transport: GdbMiSession,
  selection: DebugTargetSelection,
  caller: PolicyEvaluationContext,
): Promise<void> {
  const { stages, context, timeoutMs } = await preflightDebuggerTarget(
    selection,
    caller,
  );
  const guard = createPolicyRevisionGuard(selection.projectDir);
  const deadline = performance.now() + timeoutMs;
  for (const stage of stages) {
    await dispatchAuthorizedAction(
      "debugger_mutate",
      stage,
      context,
      async () => {
        guard();
        const remaining = Math.floor(deadline - performance.now());
        if (remaining < 1)
          throw new PlatformIOError(
            "Debugger target startup timed out.",
            "DEBUG_TARGET_TIMEOUT",
          );
        const result = await transport.execute(stage.miCommand, remaining);
        guard();
        const accepted =
          stage.effect === "connect"
            ? result.result?.class === "connected" ||
              result.result?.class === "done"
            : result.result?.class === "done";
        if (result.timedOut || result.closed || !accepted) {
          transport.invalidate(new Error("Debugger target startup failed."));
          throw new PlatformIOError(
            "Debugger failed to attach or load the selected target.",
            "DEBUG_TARGET_FAILED",
            { cleanupPending: true, effect: stage.effect },
          );
        }
      },
    );
  }
}
