/** Compose trusted project metadata and one discovered probe into an owned local backend selection. */
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";
import type { prepareDebuggerProject } from "./debug-project.js";
import {
  selectDebugProbe,
  type UsbProbeRecord,
} from "../devices/debug-probe.js";
import {
  bindOpenOcdProbe,
  selectLocalDebugEndpoint,
} from "./debug-probe-binding.js";
import { bindJLinkProbe } from "./debug-jlink-binding.js";
import { resolveDebugBackendExecutable } from "./debug-discovery.js";
import { validateBackendReadyPattern } from "./debug-backend-readiness.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";

/** Selection is inert; startup still requires separate host/target grants and physical custody. */
export async function prepareLocalDebugBackend(
  prepared: Pick<
    Awaited<ReturnType<typeof prepareDebuggerProject>>,
    "projectDir" | "configuration" | "trustedBackendRoots"
  >,
  probe: UsbProbeRecord,
) {
  const guard = createPolicyRevisionGuard(prepared.projectDir);
  guard();
  const { server, readyPattern, supervisorPython } = prepared.configuration;
  if (!server || !prepared.trustedBackendRoots)
    throw new PlatformIOError(
      "Local debugger startup requires a trusted owned backend.",
      "DEBUG_BACKEND_REQUIRED",
    );
  const endpoint = selectLocalDebugEndpoint(prepared.configuration.port);
  if (!readyPattern)
    throw new PlatformIOError(
      "The configured backend has no readiness expression.",
      "DEBUG_READY_PATTERN_INVALID",
    );
  await validateBackendReadyPattern(readyPattern);
  const executable = await resolveDebugBackendExecutable(
    server.executable,
    prepared.trustedBackendRoots,
    prepared.projectDir,
  );
  const selected = selectDebugProbe([probe]);
  const command = { ...server, executable };
  const name = path.basename(executable);
  const bound = /^openocd(?:\.exe)?$/i.test(name)
    ? bindOpenOcdProbe(command, selected.probe, endpoint.port)
    : /^JLinkGDBServer(?:CL)?(?:Exe)?(?:\.exe)?$/i.test(name)
      ? bindJLinkProbe(command, selected.probe, endpoint.port)
      : undefined;
  if (!bound)
    throw new PlatformIOError(
      "This backend still requires an explicit physical probe binding adapter.",
      "DEBUG_BACKEND_BINDING_UNSUPPORTED",
    );
  guard();
  return {
    options: { pythonExecutable: supervisorPython, command: bound },
    readyPattern,
    endpoint,
    probe: selected.probe,
    resource: selected.resource,
  };
}
