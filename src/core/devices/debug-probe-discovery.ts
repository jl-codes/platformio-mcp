/** Permission-gated host USB inventory shared by debugger adapters and pre-spawn revalidation. */
import fs from "node:fs/promises";
import { listDevicesCore } from "../devices.js";
import type { SerialDevice } from "../../types.js";
import type { UsbProbeRecord } from "./debug-probe.js";
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
  const serial = await listDevicesCore();
  return { ...result, devices: bindProbeSerialPorts(result.devices, serial) };
}

/** Match complete host-reported USB identities; descriptions and historical port numbers never bind a probe. */
export function bindProbeSerialPorts(
  probes: readonly UsbProbeRecord[],
  serial: readonly SerialDevice[],
): UsbProbeRecord[] {
  if (serial.length > 1024)
    throw new PlatformIOError(
      "Serial inventory exceeds limits.",
      "DEBUG_PROBE_INVENTORY_INVALID",
    );
  return probes.map((probe) => ({
    ...probe,
    serialPorts: serial
      .filter((device) => {
        if (typeof device.hwid !== "string" || device.hwid.length > 4096)
          return false;
        const tokens = device.hwid.trim().split(/\s+/);
        const ids = tokens.filter((token) =>
          /^VID:PID=[0-9a-f]{4}:[0-9a-f]{4}$/i.test(token),
        );
        const serials = tokens.filter((token) => /^SER=\S+$/.test(token));
        return (
          ids.length === 1 &&
          serials.length === 1 &&
          ids[0].slice(8).toLowerCase() ===
            `${probe.vendorId}:${probe.productId}`.toLowerCase() &&
          serials[0].slice(4) === probe.serialNumber
        );
      })
      .map((device) => device.port),
  }));
}
