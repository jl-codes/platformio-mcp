/** Bounded redacted analysis previews for the existing command ledger. */
import { redactSecretsInText } from "../core/policy/redact.js";
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) =>
  typeof value === "string" ? redactSecretsInText(value).slice(0, 384) : null;
const integer = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

/** Preserve selected result fields only; raw crash text, credentials and executable paths are excluded. */
export function projectAnalysisLedger(name: string, input: unknown) {
  const data = record(input);
  const kind = ["decode_backtrace", "pio_decode_backtrace"].includes(name)
    ? "frames"
    : ["size_report", "pio_size_report"].includes(name)
      ? "symbols"
      : null;
  if (!kind) return {};
  const source =
    kind === "frames" ? data.frames : (data.topSymbols ?? data.top_symbols);
  if (!Array.isArray(source)) return {};
  const rows = source.slice(0, 20).map((value) => {
    const item = record(value);
    return {
      address: text(item.address),
      name: text(kind === "frames" ? item.function : item.name),
      file: text(item.file),
      line: integer(item.line),
      ...(kind === "frames"
        ? { resolved: item.resolved === true }
        : { size: integer(item.size) }),
    };
  });
  const hash = record(data.elf).sha256 ?? data.elf_sha256;
  return {
    analysis: {
      kind,
      rows,
      total: source.length,
      truncated: source.length > rows.length,
      elfSha256:
        typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash)
          ? hash.toLowerCase()
          : null,
      note:
        kind === "frames"
          ? "Decoded against the selected ELF; this does not verify the firmware running on the device."
          : "Largest reported symbols; symbol sizes are not partition usage or runtime heap measurements.",
    },
  };
}
