/** Join trusted debugger selection, authorization, retained ELF lifetime and recoverable startup cleanup. */
import { createHash } from "node:crypto";
import { dispatchAuthorizedAction } from "../action-dispatcher.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import type {
  DebugClientSessions,
  OwnedDebugProcess,
} from "./debug-client-sessions.js";
import { DebugProcess, type DebugProcessOptions } from "./debug-process.js";
import { retainDebugElf, ownDebugElf } from "./debug-elf.js";
import {
  startDebuggerWithBackend,
  preflightDebuggerBackend,
} from "./debug-backend-session.js";
import type { DebugBackendProcessOptions } from "./debug-backend-process.js";
import {
  describeDebugInitializationTemplate,
  retainDebugInitializationTemplate,
  ownDebugInitialization,
  type DebugInitArtifact,
} from "./debug-init-artifact.js";
import { preflightDebugInitialization } from "./debug-init-execution.js";
import { DebugStartupFailure } from "./debug-start-failure.js";
import {
  preflightDebuggerTarget,
  type DebugTargetSelection,
} from "./debug-target.js";

/** Host-resolved configuration, never a public tool schema or request-controlled executable launcher. */
export interface PreparedDebuggerStartup {
  projectDir: string;
  environment: string;
  elfPath: string;
  expectedElfSha256: string;
  executable: string;
  trustedDebuggerRoots: readonly string[];
  target: Omit<DebugTargetSelection, "projectDir" | "sessionId">;
  approvalId?: string;
  probeIdentity?: string; // Host-discovered physical resource, included in startup and approval identity.
  initialization?: {
    template: string;
    hostApprovalId?: string;
    targetApprovalId?: string;
  };
  backend?: {
    options: DebugBackendProcessOptions;
    readyPattern: string;
    hostApprovalId?: string;
    targetApprovalId?: string;
  };
  acquireCustody: () => Promise<
    Pick<DebugProcessOptions, "custody" | "confirmProbeReleased">
  >;
}

/** Start against a host-owned probe/server selection; preserve every uncertain cleanup capability. */
export function startPreparedDebugger(
  sessions: DebugClientSessions,
  selection: PreparedDebuggerStartup,
  caller: PolicyEvaluationContext = {},
): Promise<string> {
  const backendScope = selection.backend
    ? {
        command: selection.backend.options.command,
        pythonExecutable: selection.backend.options.pythonExecutable,
        readyPattern: selection.backend.readyPattern,
      }
    : undefined;
  const initialization = selection.initialization;
  const initDescriptor = initialization
    ? describeDebugInitializationTemplate(
        initialization.template,
        {
          elfSha256: selection.expectedElfSha256,
          host: selection.target.host,
          port: selection.target.port,
          load: selection.target.load,
        },
        selection.elfPath,
      )
    : undefined;
  const requestIdentity = createHash("sha256")
    .update(
      JSON.stringify({
        projectDir: selection.projectDir,
        environment: selection.environment,
        executable: selection.executable,
        roots: selection.trustedDebuggerRoots,
        elfPath: selection.elfPath,
        expectedElfSha256: selection.expectedElfSha256,
        host: selection.target.host,
        port: selection.target.port,
        load: selection.target.load,
        timeoutMs: selection.target.timeoutMs ?? 90000,
        probeIdentity: selection.probeIdentity,
        backend: backendScope,
        initialization: initDescriptor,
        beforeLoadCommands: selection.target.beforeLoadCommands?.map((entry) =>
          entry.command.trim(),
        ),
        afterLoadCommands: selection.target.afterLoadCommands?.map((entry) =>
          entry.command.trim(),
        ),
      }),
    )
    .digest("hex");
  return sessions.start(
    selection.projectDir,
    selection.environment,
    async (sessionId) => {
      const target = {
        ...selection.target,
        elfSha256: selection.expectedElfSha256,
        projectDir: selection.projectDir,
        sessionId,
      };
      const initInput = {
        projectDir: selection.projectDir,
        sessionId,
        timeoutMs: target.timeoutMs ?? 90000,
        hostApprovalId: initialization?.hostApprovalId,
        targetApprovalId: initialization?.targetApprovalId,
      };
      if (initDescriptor)
        await preflightDebugInitialization(initDescriptor, initInput, caller);
      else await preflightDebuggerTarget(target, caller);
      if (selection.backend)
        await preflightDebuggerBackend(
          {
            debugger: {
              projectDir: selection.projectDir,
              executable: selection.executable,
              elfPath: selection.elfPath,
              trustedDebuggerRoots: selection.trustedDebuggerRoots,
            },
            backend: selection.backend.options,
            readyPattern: selection.backend.readyPattern,
            elfSha256: selection.expectedElfSha256,
            sessionId,
            timeoutMs: target.timeoutMs ?? 90000,
            hostApprovalId: selection.backend.hostApprovalId,
            targetApprovalId: selection.backend.targetApprovalId,
          },
          caller,
        );
      const args = {
        projectDir: selection.projectDir,
        environment: selection.environment,
        executable: selection.executable,
        elfPath: selection.elfPath,
        expectedElfSha256: selection.expectedElfSha256,
        host: target.host,
        port: target.port,
        load: target.load,
        probeIdentity: selection.probeIdentity,
        backend: backendScope,
        initialization: initDescriptor,
        approvalId: selection.approvalId,
      };
      return dispatchAuthorizedAction(
        "debugger_host_code",
        args,
        { ...caller, workspaceDir: selection.projectDir },
        async () => {
          const guard = createPolicyRevisionGuard(selection.projectDir);
          guard();
          const elf = await retainDebugElf(
            selection.projectDir,
            selection.elfPath,
            selection.expectedElfSha256,
          );
          let owned: OwnedDebugProcess | undefined;
          let initArtifact: DebugInitArtifact | undefined;
          try {
            guard();
            if (initialization && initDescriptor) {
              initArtifact = await retainDebugInitializationTemplate(
                initialization.template,
                initDescriptor.binding,
                elf.path,
              );
              guard();
            }
            const custody = await selection.acquireCustody();
            // DebugProcess owns release from this point, including spawn/initialization failure.
            const debuggerOptions: DebugProcessOptions = {
              ...custody,
              executable: selection.executable,
              trustedDebuggerRoots: selection.trustedDebuggerRoots,
              projectDir: selection.projectDir,
              elfPath: elf.path,
              startupTimeoutMs: target.timeoutMs,
              supervisorPython: selection.backend?.options.pythonExecutable,
            };
            const process = selection.backend
              ? await startDebuggerWithBackend(
                  {
                    debugger: debuggerOptions,
                    elfSha256: selection.expectedElfSha256,
                    backend: selection.backend.options,
                    readyPattern: selection.backend.readyPattern,
                    sessionId,
                    timeoutMs: target.timeoutMs ?? 90000,
                    hostApprovalId: selection.backend.hostApprovalId,
                    targetApprovalId: selection.backend.targetApprovalId,
                  },
                  caller,
                )
              : await DebugProcess.start(debuggerOptions);
            owned = ownDebugElf(
              initArtifact
                ? ownDebugInitialization(process, initArtifact)
                : process,
              elf,
            );
            guard();
            if (initArtifact)
              await process.initialize(initArtifact, initInput, caller);
            else await process.attach(target, caller);
            guard();
            return owned;
          } catch (error) {
            if (error instanceof DebugStartupFailure)
              throw new DebugStartupFailure(
                ownDebugElf(
                  initArtifact
                    ? ownDebugInitialization(error.cleanupOwner(), initArtifact)
                    : error.cleanupOwner(),
                  elf,
                ),
              );
            if (owned) {
              try {
                await owned.cleanupProcess();
              } catch {
                throw new DebugStartupFailure(owned);
              }
            } else {
              await initArtifact?.release();
              await elf.release();
            }
            throw error;
          }
        },
      );
    },
    requestIdentity,
  );
}
