/** Start supervised GDB against an externally managed server with host-bound target custody. */
import { PlatformIOError } from "../../utils/errors.js";
import type { ProcessDeviceCustody } from "../devices/process-device-custody.js";
import type { DeviceLeaseStore } from "../devices/device-lease.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import type { prepareDebuggerProject } from "./debug-project.js";
import type { DebugClientSessions } from "./debug-client-sessions.js";
import {
  parseRemoteDebugEndpoint,
  parseRemoteDebugSelection,
} from "./debug-remote-endpoint.js";
import { createRemoteDebugEndpointCustody } from "./debug-endpoint-custody.js";
import { startPreparedDebugger } from "./debug-startup.js";

/** A trusted host supplies identity and ownership; neither is accepted from MCP request arguments. */
export interface RemoteDebugTargetBinding {
  endpoint: string;
  /** Original operator-bound selection when endpoint is a pinned DNS result. */
  sourceEndpoint?: string;
  identity: string;
  acquireTarget(): Promise<ProcessDeviceCustody>; // Returns retained, retryable target ownership.
  revalidate(): Promise<void> | void; // Detect host binding changes before target handoff.
}

/** Internal remote composition inputs retain all existing host-code and target permission gates. */
export interface RemoteDebuggerStartup {
  prepared: Awaited<ReturnType<typeof prepareDebuggerProject>>;
  binding: RemoteDebugTargetBinding;
  timeoutMs: number;
  deadline?: number;
  approvalId?: string;
  initializationHostApprovalId?: string;
  initializationTargetApprovalId?: string;
  leaseStore?: DeviceLeaseStore;
}

/** Connect only after matching the resolved project endpoint to a host binding and preflighting startup. */
export async function startRemotePreparedDebugger(
  sessions: DebugClientSessions,
  input: RemoteDebuggerStartup,
  caller: PolicyEvaluationContext = {},
) {
  const { prepared, binding } = input;
  const guard = createPolicyRevisionGuard(prepared.projectDir);
  guard();
  if (prepared.configuration.server)
    throw new PlatformIOError(
      "Remote startup cannot launch a configured local backend.",
      "DEBUG_REMOTE_BACKEND_CONFLICT",
    );
  const selectedEndpoint = parseRemoteDebugSelection(
    prepared.configuration.port,
  );
  const sourceEndpoint = parseRemoteDebugSelection(
    binding.sourceEndpoint ?? binding.endpoint,
  );
  const endpoint = parseRemoteDebugEndpoint(binding.endpoint);
  const identity = binding.identity;
  if (
    selectedEndpoint.resource.identity !== sourceEndpoint.resource.identity ||
    selectedEndpoint.port !== endpoint.port ||
    (selectedEndpoint.resource.identity.startsWith("debug-tcp:") &&
      selectedEndpoint.resource.identity !== endpoint.resource.identity) ||
    typeof identity !== "string" ||
    !identity.trim() ||
    identity.length > 1024 ||
    /[\x00-\x1f\x7f]/.test(identity) ||
    typeof binding.acquireTarget !== "function" ||
    typeof binding.revalidate !== "function"
  )
    throw new PlatformIOError(
      "Remote debugger endpoint has no matching host target binding.",
      "DEBUG_REMOTE_BINDING_INVALID",
    );
  const revalidate = binding.revalidate.bind(binding);
  const acquireTarget = binding.acquireTarget.bind(binding);
  let acquired = false;
  return startPreparedDebugger(
    sessions,
    {
      projectDir: prepared.projectDir,
      environment: prepared.environment,
      debugTool: prepared.configuration.debugTool,
      elfPath: prepared.elfPath,
      expectedElfSha256: prepared.expectedElfSha256,
      executable: prepared.executable,
      trustedDebuggerRoots: prepared.trustedDebuggerRoots,
      supervisorPython: prepared.configuration.supervisorPython,
      probeIdentity: identity,
      deadline: input.deadline,
      approvalId: input.approvalId,
      target: {
        host: endpoint.host,
        port: endpoint.port,
        load: prepared.load,
        timeoutMs: input.timeoutMs,
      },
      initialization: {
        template: prepared.configuration.generatedInitTemplate,
        hostApprovalId: input.initializationHostApprovalId,
        targetApprovalId: input.initializationTargetApprovalId,
      },
      acquireCustody: async () => {
        guard();
        if (acquired)
          throw new PlatformIOError(
            "Remote debugger custody has already been acquired.",
            "DEBUG_CUSTODY_REUSED",
          );
        acquired = true;
        return {
          custody: createRemoteDebugEndpointCustody(
            endpoint,
            async () => {
              guard();
              await revalidate();
              guard();
              const target = await acquireTarget();
              return {
                prepareSpawn: async () => {
                  guard();
                  await revalidate();
                  guard();
                  await target.prepareSpawn();
                  guard();
                },
                releaseAfterExit: () => target.releaseAfterExit(),
              };
            },
            input.leaseStore,
          ),
        };
      },
    },
    caller,
  );
}
