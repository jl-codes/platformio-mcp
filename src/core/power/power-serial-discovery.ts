/** Bind power devices to authorized native serial snapshots and existing endpoint/USB exclusion keys. */
import fs from "node:fs/promises";
import { PlatformIOError } from "../../utils/errors.js";
import { dispatchAuthorizedAction } from "../action-dispatcher.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import { NativeSerialDiscovery } from "../devices/native-serial-discovery.js";
import {
  bindSerialDiscovery,
  type SerialDiscoveryRecord,
} from "../devices/serial-discovery-binding.js";
import { resolveSerialEndpoint } from "../devices/serial-endpoint.js";
import type { PowerCustodyBinding } from "./power-device-custody.js";

/** Bind an explicit port to host-observed USB metadata; this does not identify its model or prove DUT wiring. */
export function bindPowerSerialDevice(
  port: string,
  records: readonly SerialDiscoveryRecord[],
  enumerate: () => Promise<readonly SerialDiscoveryRecord[]>,
  resolve = resolveSerialEndpoint,
) {
  const endpoint = resolve(port);
  const binding = bindSerialDiscovery(endpoint, records, resolve);
  if (!binding.usbIdentity)
    throw new PlatformIOError(
      "Power devices require a stable host-observed USB descriptor; endpoint-only binding is insufficient.",
      "POWER_DEVICE_IDENTITY_REQUIRED",
    );
  const custody: PowerCustodyBinding = {
    resources: [
      endpoint.resource,
      { kind: "serial", identity: binding.usbIdentity },
    ],
    async revalidate() {
      binding.revalidate(await enumerate());
    },
  };
  return {
    port: endpoint.canonicalPort,
    identityBasis: binding.identityBasis,
    custody,
  };
}

/** Grant at most three metadata snapshots for initial meter/DUT selection and each pre-spawn refresh. */
export async function withPowerSerialDiscovery<T>(
  input: {
    projectDir: string;
    meterPort: string;
    dutPort: string;
    approvalId?: string;
  },
  caller: PolicyEvaluationContext,
  execute: (
    read: () => Promise<readonly SerialDiscoveryRecord[]>,
  ) => Promise<T>,
) {
  // Endpoint normalization validates bounded port syntax without opening either device.
  const meter = resolveSerialEndpoint(input.meterPort),
    dut = resolveSerialEndpoint(input.dutPort);
  if (meter.resource.identity === dut.resource.identity)
    throw new PlatformIOError(
      "Meter and DUT ports must be distinct.",
      "POWER_BINDING_INVALID",
    );
  const projectDir = await fs.realpath(input.projectDir);
  return dispatchAuthorizedAction(
    "serial_startup_discovery",
    {
      projectDir,
      meterPort: meter.canonicalPort,
      dutPort: dut.canonicalPort,
      approvalId: input.approvalId,
      discoveryPurpose: "ppk2_meter_and_dut",
      maximumReads: 3,
    },
    { ...caller, workspaceDir: projectDir },
    async () => {
      const guard = createPolicyRevisionGuard(projectDir);
      let active = true,
        remaining = 3;
      const assertActive = () => {
        if (!active)
          throw new PlatformIOError(
            "Power discovery authority expired.",
            "POWER_DISCOVERY_EXPIRED",
          );
        guard();
      };
      const discovery = new NativeSerialDiscovery({
        authorize: async () => {
          assertActive();
          if (remaining <= 0)
            throw new PlatformIOError(
              "Power discovery snapshot budget exhausted.",
              "POWER_DISCOVERY_EXPIRED",
            );
          remaining--;
          return assertActive;
        },
      });
      try {
        return await execute(() => discovery.list());
      } finally {
        active = false;
      }
    },
  );
}
