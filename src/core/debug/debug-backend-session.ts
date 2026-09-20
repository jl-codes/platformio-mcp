/** Join backend and GDB cleanup under one probe lease, preserving a retryable owner on every uncertain startup failure. */
import { PlatformIOError } from "../../utils/errors.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import { dispatchAuthorizedAction, planAction } from "../action-dispatcher.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import { DebugProcess, type DebugProcessOptions } from "./debug-process.js";
import {
  DebugBackendProcess,
  type DebugBackendProcessOptions,
} from "./debug-backend-process.js";
import {
  validateBackendReadyPattern,
  waitForBackendReady,
} from "./debug-backend-readiness.js";
import { DebugStartupFailure } from "./debug-start-failure.js";
import type { OwnedDebugProcess } from "./debug-client-sessions.js";

/** All paths/commands/probe custody must be host-resolved; the helper owns cleanup from entry onward. */
export interface DebugBackendSessionInput {
  debugger: DebugProcessOptions;
  backend: DebugBackendProcessOptions;
  readyPattern: string;
  elfSha256?: string; // Stable retained-image identity; avoids binding grants to random snapshot paths.
  sessionId: string;
  timeoutMs: number;
  hostApprovalId?: string;
  targetApprovalId?: string;
}

/** Plan backend effects before artifact/custody allocation, using the same scope as execution. */
export async function preflightDebuggerBackend(
  input: Omit<DebugBackendSessionInput, "debugger"> & {
    debugger: Pick<
      DebugProcessOptions,
      "projectDir" | "executable" | "elfPath" | "trustedDebuggerRoots"
    >;
  },
  caller: PolicyEvaluationContext = {},
) {
  const selected = input.debugger;
  if (
    !input.sessionId ||
    (input.elfSha256 !== undefined &&
      !/^[a-f0-9]{64}$/i.test(input.elfSha256)) ||
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > 600000
  )
    throw new PlatformIOError(
      "Invalid backend startup scope.",
      "DEBUG_BACKEND_INPUT_INVALID",
    );
  await validateBackendReadyPattern(input.readyPattern);
  const base = {
    projectDir: selected.projectDir,
    sessionId: input.sessionId,
    command: input.backend.command,
    debuggerExecutable: selected.executable,
    elfPath: input.elfSha256 ? undefined : selected.elfPath,
    elfSha256: input.elfSha256?.toLowerCase(),
    trustedDebuggerRoots: selected.trustedDebuggerRoots,
    pythonExecutable: input.backend.pythonExecutable,
    readyPattern: input.readyPattern,
    timeoutMs: input.timeoutMs,
    purpose: "debugger_backend_start",
  };
  const context = { ...caller, workspaceDir: selected.projectDir };
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
  return { stages, context };
}

/** Authorize backend target/host effects, wait for readiness, then start GDB with joint cleanup. */
export async function startDebuggerWithBackend(
  input: DebugBackendSessionInput,
  caller: PolicyEvaluationContext = {},
): Promise<DebugProcess> {
  const { debugger: selected } = input;
  let backend: DebugBackendProcess | undefined;
  let released = false;
  let debuggerProcess: DebugProcess | undefined;
  const guard = createPolicyRevisionGuard(selected.projectDir);
  const cleanupBackend = async () => {
    if (released) return;
    if (backend) await backend.cleanupProcess();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let confirmed = false;
    try {
      confirmed = await Promise.race([
        selected.confirmProbeReleased(),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 1000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (!confirmed)
      throw new PlatformIOError(
        "Debug probe release is unconfirmed.",
        "DEBUG_BACKEND_CLEANUP_PENDING",
        { cleanupPending: true },
      );
    selected.custody.releaseAfterExit();
    released = true;
  };
  const recovery: OwnedDebugProcess = {
    async command() {
      throw new PlatformIOError(
        "Backend startup failed; only cleanup is available.",
        "DEBUG_SESSION_RECOVERY_ONLY",
      );
    },
    state() {
      const state = backend?.state();
      return {
        running: false,
        closed: state?.closed ?? true,
        exitCode: null,
        failed: true,
        lastStop: undefined,
        pid: state?.pid,
        cleanupPending: !released,
        stderr: state?.outputTail ?? "",
      };
    },
    cleanupProcess: cleanupBackend,
  };
  try {
    const { stages, context } = await preflightDebuggerBackend(input, caller);
    return await dispatchAuthorizedAction(
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
            const deadline = performance.now() + input.timeoutMs;
            const remaining = () => {
              guard();
              const value = Math.floor(deadline - performance.now());
              if (value < 1)
                throw new PlatformIOError(
                  "Debugger backend startup timed out.",
                  "DEBUG_BACKEND_READY_TIMEOUT",
                );
              return value;
            };
            await selected.custody.prepareSpawn();
            remaining();
            backend = new DebugBackendProcess(input.backend);
            await backend.waitStarted(remaining());
            await waitForBackendReady(backend, input.readyPattern, {
              timeoutMs: remaining(),
              guard,
            });
            remaining();
            debuggerProcess = await DebugProcess.start({
              ...selected,
              startupTimeoutMs: remaining(),
              custody: {
                prepareSpawn: () => {
                  remaining();
                },
                releaseAfterExit: () => {
                  if (released) return;
                  if (backend!.state().cleanupPending)
                    throw new PlatformIOError(
                      "Backend still owns the probe.",
                      "DEBUG_BACKEND_CLEANUP_PENDING",
                      { cleanupPending: true },
                    );
                  selected.custody.releaseAfterExit();
                  released = true;
                },
              },
              confirmProbeReleased: async () => {
                await backend!.cleanupProcess();
                return selected.confirmProbeReleased();
              },
            });
            guard();
            return debuggerProcess;
          },
        ),
    );
  } catch (error) {
    // A GDB failure already retains an owner that knows how to clean both processes.
    if (error instanceof DebugStartupFailure) throw error;
    if (debuggerProcess) {
      try {
        await debuggerProcess.cleanupProcess();
      } catch {
        throw new DebugStartupFailure(debuggerProcess);
      }
      throw error;
    }
    try {
      await cleanupBackend();
    } catch {
      throw new DebugStartupFailure(recovery);
    }
    throw error;
  }
}
