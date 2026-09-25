/** Resolve one fixed IPv4 OTA destination before authorization and lease acquisition. */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { PlatformIOError } from "../../utils/errors.js";
import { DeviceLeaseStore, type DeviceResource } from "./device-lease.js";
import type { ProcessDeviceCustody } from "./process-device-custody.js";

/** Host-owned DNS dependency; no request can supply a resolver or invent an address binding. */
export type OtaHostLookup = (
  host: string,
) => Promise<readonly { address: string; family: number }[]>;

/** Pin a single unicast address; transport must use address, never resolve the original hostname again. */
export async function resolveOtaTarget(
  host: string,
  port: number,
  resolve: OtaHostLookup = (host) => lookup(host, { all: true, family: 4 }),
) {
  if (
    typeof host !== "string" ||
    !host ||
    host.length > 253 ||
    host !== host.trim() ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new PlatformIOError("Invalid OTA destination.", "OTA_TARGET_INVALID");
  const name = host.toLowerCase().replace(/\.$/, "");
  if (
    !isIP(name) &&
    !name
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new PlatformIOError(
      "OTA host must be an IPv4 address or DNS name, without a URL, path or port.",
      "OTA_TARGET_INVALID",
    );
  if (isIP(name) === 6)
    throw new PlatformIOError(
      "This OTA target resolver requires IPv4.",
      "OTA_ADDRESS_UNSUPPORTED",
    );
  let addresses: readonly { address: string; family: number }[];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses =
      isIP(name) === 4
        ? [{ address: name, family: 4 }]
        : await Promise.race([
            resolve(name),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new PlatformIOError(
                      "OTA name resolution timed out.",
                      "OTA_DNS_TIMEOUT",
                    ),
                  ),
                5000,
              );
            }),
          ]);
  } catch (error) {
    if (error instanceof PlatformIOError) throw error;
    throw new PlatformIOError(
      "OTA hostname could not be resolved.",
      "OTA_HOST_NOT_FOUND",
    );
  } finally {
    clearTimeout(timer);
  }
  if (!Array.isArray(addresses) || addresses.length > 64)
    throw new PlatformIOError(
      "Invalid OTA DNS response.",
      "OTA_TARGET_INVALID",
    );
  const unique = [
    ...new Set(
      addresses
        .filter((item) => item.family === 4 && isIP(item.address) === 4)
        .map((item) => item.address),
    ),
  ];
  if (unique.length !== 1)
    throw new PlatformIOError(
      "Select one OTA IPv4 address explicitly.",
      "OTA_TARGET_AMBIGUOUS",
    );
  const address = unique[0];
  const first = Number(address.split(".")[0]);
  if (first === 0 || first >= 224 || address === "255.255.255.255")
    throw new PlatformIOError(
      "OTA requires a unicast destination.",
      "OTA_TARGET_INVALID",
    );
  // Different DNS aliases and firmware/filesystem services on one host share exclusion.
  const resource: Readonly<DeviceResource> = Object.freeze({
    kind: "network",
    identity: JSON.stringify(["ota", address]),
  });
  return Object.freeze({ host: name, address, port, resource });
}

/** Coordinate aliases and upload types on the pinned host; child uncertainty prevents automatic lease reclamation. */
export function acquireOtaCustody(
  target: Awaited<ReturnType<typeof resolveOtaTarget>>,
  store = new DeviceLeaseStore(),
): ProcessDeviceCustody {
  if (
    isIP(target.address) !== 4 ||
    target.resource.kind !== "network" ||
    target.resource.identity !== JSON.stringify(["ota", target.address])
  )
    throw new PlatformIOError(
      "Invalid OTA lease binding.",
      "OTA_TARGET_INVALID",
    );
  const lease = store.acquire(target.resource);
  let released = false;
  return {
    prepareSpawn() {
      if (released)
        throw new PlatformIOError(
          "OTA custody is already released.",
          "OTA_CUSTODY_CLOSED",
        );
      store.beginHandoff(lease);
    },
    releaseAfterExit() {
      if (released) return;
      try {
        store.cancelHandoff(lease);
        store.release(lease);
        released = true;
      } catch {
        throw new PlatformIOError(
          "OTA lease cleanup is unconfirmed.",
          "OTA_CLEANUP_PENDING",
          { cleanupPending: true },
        );
      }
    },
  };
}
