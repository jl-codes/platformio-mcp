/**
 * CLI argument coercion helpers.
 *
 * `parseArgs` in ../cli.ts yields `string | boolean`: a flag given with no
 * value (`--filter --json`) parses to boolean `true`. A TypeScript `as
 * string` cast does NOT coerce at runtime, so `true` would reach a core
 * function expecting a string and blow up inside it (e.g. `listBoards`
 * calling `filter.trim()`). Every command module must coerce through these
 * helpers, never cast.
 *
 * asString/asBoolean/asNumber below are moved verbatim from the private
 * helpers that used to live in src/cli.ts, preserving their exact existing
 * behaviour (see docs/cli-first-adapter-implementation-plan.md Task 7 for a
 * variant of asBoolean/asNumber that behaves differently; the EXISTING
 * behaviour here is intentionally kept instead, since this migration must
 * not change CLI output).
 */

import type { OptionValue } from "./commands/types.js";
import { PlatformIOError } from "../utils/errors.js";

export function asString(value: OptionValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asBoolean(value: OptionValue | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return undefined;
}

export function asNumber(value: OptionValue | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * For NEW commands: absent is fine, but garbage is an error.
 *
 * Deliberately separate from `asNumber` above, which returns undefined for a
 * non-numeric value. That silent fallback is wrong for a CLI — `--lines abc`
 * quietly becoming the default is worse than failing — but `asNumber` is
 * already load-bearing for `monitor --timeout` and friends, and changing it
 * would be a behaviour change smuggled into this migration. New commands
 * (lib, project, logs, ...) use this instead; migrating the old ones is a
 * follow-up.
 */
export function parseNumberOption(
  value: OptionValue | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  // A flag given with no value parses as boolean true. That is not "absent":
  // the user typed `--lines` and meant to supply one, so silently taking the
  // default hides a mistake.
  if (typeof value === "boolean") {
    throw new PlatformIOError(
      `--${name} requires a numeric value`,
      "INVALID_ARGUMENT",
      { argument: name },
    );
  }
  const raw = value;
  // parseInt("12abc") is 12, which the doc comment says must be an error.
  const parsed = /^-?\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new PlatformIOError(
      `--${name} must be a number, received "${raw}"`,
      "INVALID_ARGUMENT",
      { argument: name, value: raw },
    );
  }
  return parsed;
}

export function asCsv(value: OptionValue | undefined): string[] | undefined {
  if (typeof value !== "string") return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

export function normalizePortOption(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  if (value.toLowerCase() === "auto") return undefined;
  return value;
}

/**
 * For required options; throws MISSING_ARGUMENT when absent or non-string.
 * New in this migration (src/cli.ts had no equivalent shared helper); not
 * substituted into any existing error path whose message text would change
 * as a result (see e.g. `port release`, which keeps its own inline check).
 */
export function requireString(
  value: OptionValue | undefined,
  name: string,
  command: string,
): string {
  const raw = asString(value);
  if (!raw) {
    throw new PlatformIOError(
      `${command} requires --${name} <value>`,
      "MISSING_ARGUMENT",
      { argument: name },
    );
  }
  return raw;
}
