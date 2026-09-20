/** Hold a physical debug-probe lease across host enumeration and owned debugger/backend execution. */
import { PlatformIOError } from "../../utils/errors.js";
import { DeviceLeaseStore } from "./device-lease.js";
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
) {
  const selected = selectDebugProbe(await enumerate(), selector);
  const lease = store.acquire(selected.resource);
  const custody: ProcessDeviceCustody = {
    async prepareSpawn() {
      const observed = selectDebugProbe(await enumerate(), {
        vendorId: selected.probe.vendorId,
        productId: selected.probe.productId,
        serialNumber: selected.probe.serialNumber,
      });
      if (observed.resource.identity !== selected.resource.identity)
        throw new PlatformIOError(
          "Selected debug probe changed before startup.",
          "DEBUG_PROBE_CHANGED",
        );
      store.beginHandoff(lease);
    },
    releaseAfterExit() {
      try {
        store.cancelHandoff(lease);
        store.release(lease);
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
