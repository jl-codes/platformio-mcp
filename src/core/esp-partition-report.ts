/**
 * Offline partition comparison and capacity reports.
 * Consumes validated layouts; observations never imply that an image was flashed.
 */
import { PlatformIOError } from "../utils/errors.js";
import {
  validateEspPartitions,
  type EspPartition,
  type EspPartitionLayout,
} from "./esp-partitions.js";

/** Actionable layout finding using the compatibility report vocabulary. */
export interface PartitionIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  fix: string;
}

const dataNames: Record<number, string> = {
  0: "ota",
  1: "phy",
  2: "nvs",
  3: "coredump",
  4: "nvs_keys",
  5: "efuse",
  6: "undefined",
  128: "esphttpd",
  129: "fat",
  130: "spiffs",
  131: "littlefs",
};
const hex = (value: number) => "0x" + value.toString(16);

/** Preserve compatibility names while retaining unknown numeric values and flag bits. */
export function projectEspPartition(part: EspPartition) {
  const subtype =
    part.type === 0
      ? part.subtype === 0
        ? "factory"
        : part.subtype === 32
          ? "test"
          : part.subtype >= 16 && part.subtype < 32
            ? "ota_" + (part.subtype - 16)
            : hex(part.subtype)
      : part.type === 1
        ? (dataNames[part.subtype] ?? hex(part.subtype))
        : hex(part.subtype);
  return {
    name: part.name,
    type: part.type === 0 ? "app" : part.type === 1 ? "data" : hex(part.type),
    subtype,
    offset: part.offset,
    size: part.size,
    flags: [
      ...(part.flags & 1 ? ["encrypted"] : []),
      ...(part.flags & 2 ? ["readonly"] : []),
    ],
    unknown_flags: (part.flags & ~3) >>> 0,
    offset_hex: hex(part.offset),
    size_hex: hex(part.size),
    end_hex: hex(part.offset + part.size),
  };
}

/** Compare validated layouts including encryption/read-only changes, unlike offset-only checks. */
export function compareEspPartitions(
  expected: readonly EspPartition[],
  observed: readonly EspPartition[],
  layout: EspPartitionLayout,
) {
  validateEspPartitions(expected, layout);
  validateEspPartitions(observed, layout);
  const wanted = new Map(expected.map((part) => [part.name, part]));
  const actual = new Map(observed.map((part) => [part.name, part]));
  const differences: Array<{
    name: string;
    kind: "missing_on_device" | "changed" | "extra_on_device";
    fields?: string[];
    expected?: ReturnType<typeof projectEspPartition>;
    device?: ReturnType<typeof projectEspPartition>;
  }> = [];
  for (const [name, part] of wanted) {
    const other = actual.get(name);
    if (!other)
      differences.push({
        name,
        kind: "missing_on_device",
        expected: projectEspPartition(part),
      });
    else {
      const fields = (
        ["type", "subtype", "offset", "size", "flags"] as const
      ).filter((field) => part[field] !== other[field]);
      if (fields.length)
        differences.push({
          name,
          kind: "changed",
          fields,
          expected: projectEspPartition(part),
          device: projectEspPartition(other),
        });
    }
  }
  for (const [name, part] of actual) {
    if (!wanted.has(name))
      differences.push({
        name,
        kind: "extra_on_device",
        device: projectEspPartition(part),
      });
  }
  const order = { missing_on_device: 0, changed: 1, extra_on_device: 2 };
  return differences.sort(
    (a, b) =>
      order[a.kind] - order[b.kind] ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

/** Check capacity and boot-layout requirements without inventing unknown firmware or flash sizes. */
export function reportEspPartitions(
  parts: readonly EspPartition[],
  layout: EspPartitionLayout,
  firmwareSize?: number,
) {
  validateEspPartitions(parts, { tableOffset: layout.tableOffset });
  if (
    layout.flashSize !== undefined &&
    (!Number.isSafeInteger(layout.flashSize) ||
      layout.flashSize <= 0 ||
      layout.flashSize > 0x100000000)
  )
    throw new PlatformIOError("Invalid flash size.", "PARTITION_TABLE_INVALID");
  if (
    firmwareSize !== undefined &&
    (!Number.isSafeInteger(firmwareSize) ||
      firmwareSize < 0 ||
      firmwareSize > 0xffffffff)
  )
    throw new PlatformIOError(
      "Invalid firmware size.",
      "PARTITION_TABLE_INVALID",
    );
  const issues: PartitionIssue[] = [];
  const add = (
    severity: PartitionIssue["severity"],
    code: string,
    message: string,
    fix: string,
  ) => issues.push({ severity, code, message, fix });
  const apps = parts.filter((part) => part.type === 0);
  const slots = apps.filter((part) => part.subtype >= 16 && part.subtype < 32);
  const hasData = (subtype: number) =>
    parts.some((part) => part.type === 1 && part.subtype === subtype);
  const end = Math.max(
    layout.tableOffset + 0x1000,
    ...parts.map((part) => part.offset + part.size),
  );
  if (!parts.length)
    add(
      "error",
      "empty_table",
      "The table contains no partitions.",
      "Select the project's effective partition table.",
    );
  if (!apps.length)
    add(
      "error",
      "no_app",
      "No application partition is present.",
      "Add an application partition suitable for the selected chip.",
    );
  if (slots.length && !hasData(0))
    add(
      "error",
      "ota_without_otadata",
      "OTA application slots have no OTA selection metadata.",
      "Add a correctly sized OTA metadata partition.",
    );
  if (!slots.length && hasData(0))
    add(
      "warning",
      "otadata_without_ota",
      "OTA selection metadata exists without OTA application slots.",
      "Check whether OTA is intended for this layout.",
    );
  if (slots.length === 1)
    add(
      "warning",
      "single_ota_slot",
      "Only one OTA application slot is available.",
      "Review update recovery and add an alternate slot if needed.",
    );
  if (new Set(slots.map((part) => part.size)).size > 1)
    add(
      "warning",
      "uneven_ota_slots",
      "OTA slots have different capacities.",
      "Ensure each intended update fits its destination slot.",
    );
  if (!hasData(2))
    add(
      "warning",
      "no_nvs",
      "The layout has no NVS partition.",
      "Check application persistence and framework requirements.",
    );
  if (!hasData(3))
    add(
      "info",
      "no_coredump",
      "No flash core-dump partition is present.",
      "Configure crash storage if flash core dumps are required.",
    );
  if (layout.flashSize !== undefined) {
    if (end > layout.flashSize)
      add(
        "error",
        "exceeds_flash",
        "The layout extends beyond the supplied flash capacity.",
        "Verify the actual chip capacity and partition sizes.",
      );
    else if (layout.flashSize - end >= 1048576)
      add(
        "info",
        "unused_flash",
        String(layout.flashSize - end) +
          " trailing flash bytes are unassigned.",
        "Review whether the remaining capacity should be allocated.",
      );
  }
  const fits =
    firmwareSize === undefined
      ? []
      : apps.map((part) => ({
          name: part.name,
          size: part.size,
          firmware_size: firmwareSize,
          fits: firmwareSize <= part.size,
          used_percent: Math.round((firmwareSize / part.size) * 1000) / 10,
        }));
  if (fits.length) {
    const limiting = fits.reduce((a, b) => (a.size <= b.size ? a : b));
    if (!limiting.fits)
      add(
        "error",
        "app_too_big",
        "Firmware exceeds app partition " + limiting.name + ".",
        "Select the intended destination explicitly or reduce firmware size.",
      );
    else if (limiting.used_percent >= 90)
      add(
        "warning",
        "app_nearly_full",
        "Firmware uses " +
          limiting.used_percent +
          "% of the smallest app partition.",
        "Review space needed for future updates.",
      );
    else
      add(
        "info",
        "app_fits",
        "Firmware fits all declared application partitions.",
        "",
      );
  }
  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    table_offset: layout.tableOffset,
    table_end: end,
    flash_size: layout.flashSize ?? null,
    firmware_size: firmwareSize ?? null,
    partitions: parts.map(projectEspPartition),
    application_fit: fits,
    issues,
    error_count: issues.filter((issue) => issue.severity === "error").length,
    warning_count: issues.filter((issue) => issue.severity === "warning")
      .length,
    evidence: "offline_layout" as const,
  };
}
