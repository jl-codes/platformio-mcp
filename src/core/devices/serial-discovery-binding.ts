/**
 * Validated serial discovery snapshots, independent of enumeration and device opening.
 * Provides bindSerialDiscovery for trusted adapters to bind endpoint and optional USB identity.
 */
import { createHash } from "node:crypto";
import { PlatformIOError } from "../../utils/errors.js";
import type { ResolvedSerialEndpoint } from "./serial-endpoint.js";

/** Structured OS enumeration fields; descriptions and board-name guesses are not identity. */
export interface SerialDiscoveryRecord {
  path: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
}
/** Both scopes must be coordinated; a USB key alone does not replace endpoint exclusion. */
export interface SerialDiscoveryBinding {
  readonly endpointIdentity: string;
  readonly usbIdentity?: string;
  readonly identityBasis: "usb-descriptor" | "endpoint-only";
  revalidate(records: readonly SerialDiscoveryRecord[]): void;
}

/** Validate bounded structured metadata before hashing; missing descriptors remain explicitly weaker. */
function descriptor(record: SerialDiscoveryRecord): string | undefined {
  for (const field of [
    record.path,
    record.vendorId,
    record.productId,
    record.serialNumber,
  ]) {
    if (
      field !== undefined &&
      (typeof field !== "string" ||
        field.length > 512 ||
        /[\x00-\x1f\x7f]/.test(field))
    )
      throw new PlatformIOError(
        "Invalid serial discovery metadata.",
        "SERIAL_DISCOVERY_INVALID",
      );
  }
  if (!record.path)
    throw new PlatformIOError(
      "Missing serial discovery path.",
      "SERIAL_DISCOVERY_INVALID",
    );
  for (const id of [record.vendorId, record.productId]) {
    if (id !== undefined && !/^[0-9a-f]{4}$/i.test(id))
      throw new PlatformIOError(
        "Invalid USB identifier.",
        "SERIAL_DISCOVERY_INVALID",
      );
  }
  if (!record.vendorId || !record.productId || !record.serialNumber)
    return undefined;
  return createHash("sha256")
    .update(
      JSON.stringify([
        record.vendorId.toLowerCase(),
        record.productId.toLowerCase(),
        record.serialNumber,
      ]),
    )
    .digest("hex");
}

/**
 * Bind one explicitly selected endpoint to a bounded trusted enumeration snapshot.
 * Enumeration and resolution are supplied by the adapter, never by public tool arguments.
 * Duplicate USB descriptors on distinct endpoints are ambiguous, including multi-interface devices.
 * USB descriptors are not cryptographic board authentication and never authorize automatic reconnect.
 */
export function bindSerialDiscovery(
  endpoint: ResolvedSerialEndpoint,
  records: readonly SerialDiscoveryRecord[],
  resolve: (port: string) => ResolvedSerialEndpoint,
): SerialDiscoveryBinding {
  const inspect = (snapshot: readonly SerialDiscoveryRecord[]) => {
    if (!Array.isArray(snapshot) || snapshot.length > 1024)
      throw new PlatformIOError(
        "Invalid serial discovery snapshot.",
        "SERIAL_DISCOVERY_INVALID",
      );
    const normalized = snapshot.map((record) => {
      if (!record || typeof record !== "object")
        throw new PlatformIOError(
          "Invalid serial discovery entry.",
          "SERIAL_DISCOVERY_INVALID",
        );
      const usb = descriptor(record);
      return { endpoint: resolve(record.path).resource.identity, usb };
    });
    const matches = normalized.filter(
      (record) => record.endpoint === endpoint.resource.identity,
    );
    if (!matches.length)
      throw new PlatformIOError(
        "Selected serial endpoint is absent from discovery.",
        "SERIAL_DEVICE_UNAVAILABLE",
      );
    const identities = new Set(matches.map((record) => record.usb));
    if (identities.size !== 1)
      throw new PlatformIOError(
        "Conflicting discovery metadata for the selected endpoint.",
        "SERIAL_DEVICE_AMBIGUOUS",
      );
    const usb = matches[0].usb;
    if (
      usb &&
      normalized.some(
        (record) =>
          record.usb === usb && record.endpoint !== endpoint.resource.identity,
      )
    )
      throw new PlatformIOError(
        "USB identity is shared by multiple endpoints.",
        "SERIAL_DEVICE_AMBIGUOUS",
      );
    return usb;
  };
  endpoint.revalidate();
  const expected = inspect(records);
  return Object.freeze({
    endpointIdentity: endpoint.resource.identity,
    usbIdentity: expected === undefined ? undefined : `usb:${expected}`,
    identityBasis:
      expected === undefined
        ? ("endpoint-only" as const)
        : ("usb-descriptor" as const),
    revalidate(snapshot: readonly SerialDiscoveryRecord[]) {
      endpoint.revalidate();
      if (inspect(snapshot) !== expected)
        throw new PlatformIOError(
          "Serial discovery identity changed; select and authorize again.",
          "SERIAL_DEVICE_CHANGED",
        );
    },
  });
}
