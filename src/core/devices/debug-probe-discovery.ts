/** Permission-gated host USB inventory shared by debugger adapters and pre-spawn revalidation. */
import fs from "node:fs/promises";
import { PlatformIOError } from "../../utils/errors.js";
import { dispatchAuthorizedAction } from "../action-dispatcher.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import { enumerateLinuxUsbProbes } from "./linux-usb-probes.js";
import { enumerateWindowsUsbProbes } from "./windows-usb-probes.js";
import { enumerateMacosUsbProbes } from "./macos-usb-probes.js";

/** Enumerate metadata only after list-devices permission, then reject results if policy changed. */
export async function discoverDebugProbes(
  projectDir: string,
  approvalId?: string,
  caller: PolicyEvaluationContext = {},
) {
  const project = await fs.realpath(projectDir);
  return dispatchAuthorizedAction(
    "debugger_discover",
    { projectDir: project, approvalId },
    { ...caller, workspaceDir: project },
    async () => {
      const guard = createPolicyRevisionGuard(project);
      guard();
      const result = await readHostInventory();
      guard();
      return result;
    },
  );
}

/** One startup grant covers initial selection plus exactly one pre-spawn refresh, never later requests. */
export async function withDebugProbeDiscovery<T>(
  projectDir: string,
  approvalId: string | undefined,
  caller: PolicyEvaluationContext,
  execute: (read: () => ReturnType<typeof readHostInventory>) => Promise<T>,
): Promise<T> {
  const project = await fs.realpath(projectDir);
  return dispatchAuthorizedAction(
    "debugger_discover",
    {
      projectDir: project,
      approvalId,
      discoveryPurpose: "debugger_startup",
      maximumReads: 2,
    },
    { ...caller, workspaceDir: project },
    async () => {
      const guard = createPolicyRevisionGuard(project);
      let active = true,
        remaining = 2;
      const read = async () => {
        if (!active || remaining === 0)
          throw new PlatformIOError(
            "Debugger discovery authority expired or exhausted.",
            "DEBUG_DISCOVERY_AUTHORITY_INVALID",
          );
        guard();
        remaining--;
        const result = await readHostInventory();
        guard();
        if (!active)
          throw new PlatformIOError(
            "Debugger discovery completed after its operation ended.",
            "DEBUG_DISCOVERY_AUTHORITY_INVALID",
          );
        return result;
      };
      try {
        return await execute(read);
      } finally {
        active = false;
      }
    },
  );
}

/** Invoke only the fixed host-specific metadata provider; this function grants no authorization. */
async function readHostInventory() {
  const result =
    process.platform === "win32"
      ? await enumerateWindowsUsbProbes()
      : process.platform === "linux"
        ? await enumerateLinuxUsbProbes()
        : process.platform === "darwin"
          ? await enumerateMacosUsbProbes()
          : null;
  if (!result)
    throw new PlatformIOError(
      "USB probe discovery is unsupported on this host.",
      "DEBUG_PROBE_PLATFORM_UNSUPPORTED",
    );
  return result;
}
