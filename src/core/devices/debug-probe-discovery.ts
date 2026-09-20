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
      guard();
      return result;
    },
  );
}
