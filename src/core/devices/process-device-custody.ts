/**
 * Join legacy child execution to the direct-serial endpoint lease domain.
 * Endpoint exclusion does not authenticate a board or survive device re-enumeration.
 */
import { PlatformIOError } from "../../utils/errors.js";
import { DeviceLeaseStore } from "./device-lease.js";
import { resolveSerialEndpoint } from "./serial-endpoint.js";

/** Internal lifecycle capability; only confirmed child cleanup permits release. */
export interface ProcessDeviceCustody {
  prepareSpawn(): void | Promise<void>; // Revalidate endpoint and persist uncertainty before creating a child.
  releaseAfterExit(): void; // Trusted caller proves no child started or execution has terminated.
}

/** Acquire the same endpoint key used by direct serial sessions, without opening hardware. */
export function acquireProcessDeviceCustody(
  port: string,
  dependencies: {
    store?: DeviceLeaseStore;
    resolve?: typeof resolveSerialEndpoint;
  } = {},
): ProcessDeviceCustody {
  const store = dependencies.store ?? new DeviceLeaseStore();
  const endpoint = (dependencies.resolve ?? resolveSerialEndpoint)(port);
  const lease = store.acquire(endpoint.resource);
  return {
    prepareSpawn() {
      endpoint.revalidate();
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
            : "Device lease cleanup failed.",
          "DEVICE_CLEANUP_PENDING",
          { cleanupPending: true },
        );
      }
    },
  };
}
