/** Select a unique physical USB debug probe from trusted host inventory, never from backend names. */
import { PlatformIOError } from "../../utils/errors.js";
import type { DeviceResource } from "./device-lease.js";

/** Host-enumerated physical USB identity; interface records may share a physical location. */
export interface UsbProbeRecord {
  vendorId: string;
  productId: string;
  serialNumber: string;
  location: string;
  serialPorts?: readonly string[]; // Same-device endpoints from authorized host enumeration.
}

/** Caller selection narrows trusted discovery; it does not assert device presence or ownership. */
export interface DebugProbeSelector {
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
}

/** Resolve duplicate interfaces and fail closed for absent, ambiguous or duplicate-serial devices. */
export function selectDebugProbe(
  records: readonly UsbProbeRecord[],
  selector: DebugProbeSelector = {},
): { resource: DeviceResource; probe: Readonly<UsbProbeRecord> } {
  const invalid = (): never => {
    throw new PlatformIOError(
      "Invalid USB probe discovery metadata.",
      "DEBUG_PROBE_IDENTITY_INVALID",
    );
  };
  const hex = (value: string) => {
    if (typeof value !== "string" || !/^(?:0x)?[a-f0-9]{4}$/i.test(value))
      return invalid();
    return value.replace(/^0x/i, "").toLowerCase();
  };
  const text = (value: string) => {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      Buffer.byteLength(value) > 256 ||
      /[\x00-\x1f\x7f]/.test(value)
    )
      return invalid();
    return value;
  };
  if (!Array.isArray(records) || records.length > 1024) return invalid();
  const vendor =
    selector.vendorId === undefined ? undefined : hex(selector.vendorId);
  const product =
    selector.productId === undefined ? undefined : hex(selector.productId);
  const serial =
    selector.serialNumber === undefined
      ? undefined
      : text(selector.serialNumber);
  const candidates = new Map<
    string,
    { probe: UsbProbeRecord; locations: Set<string> }
  >();
  for (const record of records) {
    if (
      record.serialPorts !== undefined &&
      (!Array.isArray(record.serialPorts) ||
        record.serialPorts.length > 32 ||
        record.serialPorts.some(
          (port: unknown) =>
            typeof port !== "string" ||
            !port ||
            port.length > 512 ||
            /[\x00-\x1f\x7f]/.test(port),
        ))
    )
      return invalid();
    const probe = {
      vendorId: hex(record.vendorId),
      productId: hex(record.productId),
      serialNumber: text(record.serialNumber),
      location: text(record.location),
      ...(record.serialPorts === undefined
        ? {}
        : {
            serialPorts: [
              ...new Set<string>(record.serialPorts as string[]),
            ].sort(),
          }),
    };
    if (
      (vendor && probe.vendorId !== vendor) ||
      (product && probe.productId !== product) ||
      (serial && probe.serialNumber !== serial)
    )
      continue;
    const identity = JSON.stringify([
      "usb",
      probe.vendorId,
      probe.productId,
      probe.serialNumber,
    ]);
    const previous = candidates.get(identity);
    if (previous) {
      previous.locations.add(probe.location);
      if (probe.serialPorts || previous.probe.serialPorts)
        previous.probe.serialPorts = [
          ...new Set([
            ...(previous.probe.serialPorts ?? []),
            ...(probe.serialPorts ?? []),
          ]),
        ].sort();
    } else
      candidates.set(identity, { probe, locations: new Set([probe.location]) });
  }
  if (
    candidates.size !== 1 ||
    [...candidates.values()].some((value) => value.locations.size !== 1)
  )
    throw new PlatformIOError(
      candidates.size
        ? "Select one uniquely identified physical debug probe."
        : "No matching debug probe is present.",
      candidates.size ? "DEBUG_PROBE_AMBIGUOUS" : "DEBUG_PROBE_NOT_FOUND",
    );
  const [identity, { probe }] = [...candidates][0];
  return {
    resource: Object.freeze({ kind: "probe", identity }),
    probe: Object.freeze(probe),
  };
}
