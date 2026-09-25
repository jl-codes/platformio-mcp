/** Hold a physical debug-probe lease across host enumeration and owned debugger/backend execution. */
import { createHash } from "node:crypto";
import { resolveSerialEndpoint } from "./serial-endpoint.js";
import { PlatformIOError } from "../../utils/errors.js";
import { DeviceLeaseStore, type DeviceLease } from "./device-lease.js";
import {
  selectDebugProbe,
  type DebugProbeSelector,
  type UsbProbeRecord,
} from "./debug-probe.js";
import type { ProcessDeviceCustody } from "./process-device-custody.js";

/** Inventory callback is host-owned and separately authorized; no backend or hardware is opened here. */
export async function acquireDebugProbeCustody(
  enumerate: () => Promise<readonly UsbProbeRecord[]>,
  selector: DebugProbeSelector,
  store = new DeviceLeaseStore(),
  resolveEndpoint = resolveSerialEndpoint,
) {
  const selected = selectDebugProbe(await enumerate(), selector);
  const endpoints = (selected.probe.serialPorts ?? []).map((port) =>
    resolveEndpoint(port),
  );
  const usbIdentity =
    "usb:" +
    createHash("sha256")
      .update(
        JSON.stringify([
          selected.probe.vendorId,
          selected.probe.productId,
          selected.probe.serialNumber,
        ]),
      )
      .digest("hex");
  const resources = [
    selected.resource,
    { kind: "serial" as const, identity: usbIdentity },
    ...endpoints.map((endpoint) => endpoint.resource),
  ];
  const leases: DeviceLease[] = [];
  try {
    for (const resource of new Map(
      resources.map((resource) => [JSON.stringify(resource), resource]),
    ).values())
      leases.push(store.acquire(resource));
  } catch (error) {
    for (const lease of leases.reverse()) store.release(lease);
    throw error;
  }
  const released = new Set<DeviceLease>();
  const custody: ProcessDeviceCustody = {
    async prepareSpawn() {
      const observed = selectDebugProbe(await enumerate(), {
        vendorId: selected.probe.vendorId,
        productId: selected.probe.productId,
        serialNumber: selected.probe.serialNumber,
      });
      if (
        observed.resource.identity !== selected.resource.identity ||
        observed.probe.location !== selected.probe.location ||
        JSON.stringify(observed.probe.serialPorts ?? []) !==
          JSON.stringify(selected.probe.serialPorts ?? [])
      )
        throw new PlatformIOError(
          "Selected debug probe changed before startup.",
          "DEBUG_PROBE_CHANGED",
        );
      for (const endpoint of endpoints) endpoint.revalidate();
      for (const lease of leases) store.beginHandoff(lease);
    },
    releaseAfterExit() {
      try {
        for (const lease of [...leases].reverse()) {
          if (released.has(lease)) continue;
          store.cancelHandoff(lease);
          store.release(lease);
          released.add(lease);
        }
      } catch (error) {
        throw new PlatformIOError(
          error instanceof Error
            ? error.message
            : "Probe lease cleanup failed.",
          "DEVICE_CLEANUP_PENDING",
          { cleanupPending: true },
        );
      }
    },
  };
  return { ...selected, custody };
}
