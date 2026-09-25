/** Bounded macOS USB inventory from the native system profiler's structured output. */
import { PlatformIOError } from "../../utils/errors.js";
import { runAnalysisProcess } from "../analysis/analysis-process.js";
import { selectDebugProbe, type UsbProbeRecord } from "./debug-probe.js";

/** Flatten USB device trees while retaining physical location and actual serial-number evidence. */
export function parseMacosUsbProbes(output: string) {
  const invalid = (): never => {
    throw new PlatformIOError(
      "Invalid macOS USB inventory.",
      "DEBUG_PROBE_INVENTORY_INVALID",
    );
  };
  if (Buffer.byteLength(output) > 4 * 1024 * 1024) return invalid();
  let document: unknown;
  try {
    document = JSON.parse(output);
  } catch {
    return invalid();
  }
  if (
    !document ||
    typeof document !== "object" ||
    !Array.isArray((document as Record<string, unknown>).SPUSBDataType)
  )
    return invalid();
  const devices: UsbProbeRecord[] = [];
  let unidentified = 0,
    nodes = 0;
  const visit = (items: unknown[], depth: number) => {
    if (depth > 32) return invalid();
    for (const item of items) {
      if (
        ++nodes > 4096 ||
        !item ||
        typeof item !== "object" ||
        Array.isArray(item)
      )
        return invalid();
      const record = item as Record<string, unknown>;
      if (record.vendor_id !== undefined || record.product_id !== undefined) {
        const hex = (value: unknown) => {
          if (typeof value !== "string" || value.length > 512) return invalid();
          const match = /^0x([a-f0-9]{4})(?:\s.*)?$/i.exec(value);
          return match?.[1] ?? invalid();
        };
        const vendorId = hex(record.vendor_id),
          productId = hex(record.product_id);
        if (
          typeof record.serial_num !== "string" ||
          !record.serial_num ||
          typeof record.location_id !== "string" ||
          !record.location_id
        )
          unidentified++;
        else {
          const location = /^0x([a-f0-9]{1,16})(?:\s.*)?$/i.exec(
            record.location_id,
          );
          if (!location) return invalid();
          devices.push(
            selectDebugProbe([
              {
                vendorId,
                productId,
                serialNumber: record.serial_num,
                location: "usb:" + location[1].toLowerCase(),
              },
            ]).probe,
          );
        }
      }
      if (record._items !== undefined) {
        if (!Array.isArray(record._items)) return invalid();
        visit(record._items, depth + 1);
      }
    }
  };
  visit((document as { SPUSBDataType: unknown[] }).SPUSBDataType, 0);
  return { devices, unidentified, source: "macos_system_profiler" as const };
}

/** Fixed native command only; read-only discovery never invokes project scripts or opens a probe. */
export async function enumerateMacosUsbProbes() {
  if (process.platform !== "darwin")
    throw new PlatformIOError(
      "macOS USB discovery is unavailable.",
      "DEBUG_PROBE_PLATFORM_UNSUPPORTED",
    );
  const result = await runAnalysisProcess(
    "/usr/sbin/system_profiler",
    ["SPUSBDataType", "-json", "-detailLevel", "full"],
    { timeoutMs: 30000, maxOutputBytes: 4 * 1024 * 1024 },
  );
  return parseMacosUsbProbes(result.stdout);
}
