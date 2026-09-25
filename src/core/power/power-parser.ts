/** Parse bounded serial current/voltage captures using the shared terminable regex worker. */
import { extractBoundedCaptures } from "../bounded-pattern.js";
import { PlatformIOError } from "../../utils/errors.js";

// Reference default: first current-like number; optional voltage appears after that reading.
const DEFAULT_PATTERN = String.raw`(?<value>-?\d+(?:\.\d+)?)\s*(?<unit>[uµ]A|mA|A)?(?![\w.])(?:.*?(?<voltage>-?\d+(?:\.\d+)?)\s*(?<vunit>mV|V)(?![\w.]))?`;
const CURRENT_SCALE: Readonly<Record<string, number>> = {
  uA: 0.001,
  µA: 0.001,
  mA: 1,
  A: 1000,
};
/** One observation retains its line index so collectors can attach actual arrival timing. */
export interface ParsedPowerReading {
  line: number;
  currentMa: number;
  voltageMv: number | null;
}
function number(value: string): number {
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ||
    !Number.isFinite(Number(value))
  )
    throw new PlatformIOError(
      "Power pattern captured an invalid numeric value.",
      "POWER_VALUE_INVALID",
    );
  return Number(value);
}
/** Custom Python named groups use the documented bounded ECMAScript subset, never main-thread regex execution. */
export async function parsePowerLines(
  lines: readonly string[],
  pattern?: string,
) {
  const captures = await extractBoundedCaptures(
    lines,
    pattern || DEFAULT_PATTERN,
    { pythonNamedGroups: true },
  );
  const samples: ParsedPowerReading[] = [];
  const matched = new Set<number>();
  for (const capture of captures) {
    // The reference reads at most one current observation per serial line.
    if (matched.has(capture.line)) continue;
    const unit = capture.unit || "mA";
    if (!Object.hasOwn(CURRENT_SCALE, unit))
      throw new PlatformIOError(
        "Current unit must be uA, µA, mA or A.",
        "POWER_UNIT_INVALID",
      );
    const currentMa = number(capture.value) * CURRENT_SCALE[unit];
    let voltageMv: number | null = null;
    if (capture.voltage !== undefined) {
      const voltageUnit = capture.vunit || "V";
      if (!["V", "mV"].includes(voltageUnit))
        throw new PlatformIOError(
          "Voltage unit must be V or mV.",
          "POWER_UNIT_INVALID",
        );
      voltageMv = number(capture.voltage) * (voltageUnit === "V" ? 1000 : 1);
      if (!Number.isFinite(voltageMv) || voltageMv <= 0 || voltageMv > 1e9)
        throw new PlatformIOError(
          "Power voltage is outside analysis bounds.",
          "POWER_VALUE_INVALID",
        );
    }
    if (!Number.isFinite(currentMa) || Math.abs(currentMa) > 1e9)
      throw new PlatformIOError(
        "Power current is outside analysis bounds.",
        "POWER_VALUE_INVALID",
      );
    samples.push({ line: capture.line, currentMa, voltageMv });
    matched.add(capture.line);
  }
  return {
    samples,
    unparsedLines: lines.reduce(
      (count, line, index) =>
        count + (!matched.has(index) && line.trim() ? 1 : 0),
      0,
    ),
  };
}
