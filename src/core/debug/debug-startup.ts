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
      await preflightDebuggerTarget(target, caller);
      const args = {
        projectDir: selection.projectDir,
        environment: selection.environment,
        executable: selection.executable,
        elfPath: selection.elfPath,
        expectedElfSha256: selection.expectedElfSha256,
        host: target.host,
        port: target.port,
        load: target.load,
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
          try {
            guard();
            const custody = await selection.acquireCustody();
            // DebugProcess owns release from this point, including spawn/initialization failure.
            const process = await DebugProcess.start({
              ...custody,
              executable: selection.executable,
              trustedDebuggerRoots: selection.trustedDebuggerRoots,
              projectDir: selection.projectDir,
              elfPath: elf.path,
              startupTimeoutMs: target.timeoutMs,
            });
            owned = ownDebugElf(process, elf);
            guard();
            await process.attach(target, caller);
            guard();
            return owned;
          } catch (error) {
            if (error instanceof DebugStartupFailure)
              throw new DebugStartupFailure(
                ownDebugElf(error.cleanupOwner(), elf),
              );
            if (owned) {
              try {
                await owned.cleanupProcess();
              } catch {
                throw new DebugStartupFailure(owned);
              }
            } else {
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
