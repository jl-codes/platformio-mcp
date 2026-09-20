/** Join prepared firmware, authorized USB inventory and connection-owned debugger startup. */
import { PlatformIOError } from "../../utils/errors.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import {
  selectDebugProbe,
  type DebugProbeSelector,
  type UsbProbeRecord,
} from "../devices/debug-probe.js";
import { acquireDebugProbeCustody } from "../devices/debug-probe-custody.js";
import type { DeviceLeaseStore } from "../devices/device-lease.js";
import type { prepareDebuggerProject } from "./debug-project.js";
import type { DebugClientSessions } from "./debug-client-sessions.js";
import { prepareLocalDebugBackend } from "./debug-backend-selection.js";
import { startPreparedDebugger } from "./debug-startup.js";

/** Host capabilities must come from the authorized discovery/cleanup owners, never MCP arguments. */
export interface LocalDebuggerStartup {
  prepared: Awaited<ReturnType<typeof prepareDebuggerProject>>;
  readInventory: () => Promise<readonly UsbProbeRecord[]>;
  confirmProbeReleased: () => Promise<boolean>;
  selector?: DebugProbeSelector;
  timeoutMs: number;
  approvalId?: string;
  initializationHostApprovalId?: string;
  initializationTargetApprovalId?: string;
  backendHostApprovalId?: string;
  backendTargetApprovalId?: string;
  leaseStore?: DeviceLeaseStore; // Host/test-owned store only.
}

/** Read once for selection and once at handoff; defer lease allocation until startup preflight succeeds. */
export async function startLocalPreparedDebugger(
  sessions: DebugClientSessions,
  input: LocalDebuggerStartup,
  caller: PolicyEvaluationContext = {},
) {
  const { prepared } = input;
  const guard = createPolicyRevisionGuard(prepared.projectDir);
  guard();
  const inventory = await input.readInventory();
  guard();
  const selected = selectDebugProbe(inventory, input.selector);
  const backend = await prepareLocalDebugBackend(prepared, selected.probe);
  guard();
  let acquired = false;
  return startPreparedDebugger(
    sessions,
    {
      projectDir: prepared.projectDir,
      environment: prepared.environment,
      elfPath: prepared.elfPath,
      expectedElfSha256: prepared.expectedElfSha256,
      executable: prepared.executable,
      trustedDebuggerRoots: prepared.trustedDebuggerRoots,
      probeIdentity: JSON.stringify([
        selected.resource.identity,
        selected.probe.location,
      ]),
      target: {
        ...backend.endpoint,
        load: prepared.load,
        timeoutMs: input.timeoutMs,
      },
      approvalId: input.approvalId,
      initialization: {
        template: prepared.configuration.generatedInitTemplate,
        hostApprovalId: input.initializationHostApprovalId,
        targetApprovalId: input.initializationTargetApprovalId,
      },
      backend: {
        options: backend.options,
        readyPattern: backend.readyPattern,
        hostApprovalId: input.backendHostApprovalId,
        targetApprovalId: input.backendTargetApprovalId,
      },
      acquireCustody: async () => {
        guard();
        if (acquired)
          throw new PlatformIOError(
            "Debugger custody has already been acquired.",
            "DEBUG_CUSTODY_REUSED",
          );
        acquired = true;
        let cached = true;
        const held = await acquireDebugProbeCustody(
          async () => {
            guard();
            if (cached) {
              cached = false;
              return inventory;
            }
            const refreshed = await input.readInventory();
            guard();
            return refreshed;
          },
          selected.probe,
          input.leaseStore,
        );
        return {
          custody: held.custody,
          confirmProbeReleased: input.confirmProbeReleased,
        };
      },
    },
    caller,
  );
}
