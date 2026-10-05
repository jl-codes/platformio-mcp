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
 * Numeric options distinguish absent flags from present invalid input. The
 * legacy finite-number parser preserves supported numeric forms; commands
 * with an integer-only contract use parseNumberOption instead.
 */

import type { OptionValue } from "./commands/types.js";
import type { ZodTypeAny } from "zod";
import {
  AgentFlashMonitorVerifyParamsSchema,
  AgentMonitorHealthParamsSchema,
  AgentResolveTargetParamsSchema,
  BuildProjectParamsSchema,
  CaptureSerialWindowParamsSchema,
  ListPendingApprovalsParamsSchema,
  ListTaskHistoryParamsSchema,
  QueryLogsParamsSchema,
  SearchLibrariesParamsSchema,
} from "../types.js";
import { PlatformIOError } from "../utils/errors.js";

/** Return a supplied string without treating a bare flag as its value. */
export function asString(value: OptionValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Coerce the supported boolean flag spellings. */
export function asBoolean(value: OptionValue | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return undefined;
}

/** Parse an optional finite number without silently replacing invalid input with a default. */
export function asNumber(
  value: OptionValue | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new PlatformIOError(
      `--${name} requires a numeric value`,
      "INVALID_ARGUMENT",
      { argument: name },
    );
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new PlatformIOError(
      `--${name} must be a finite number, received "${value}"`,
      "INVALID_ARGUMENT",
      { argument: name, value },
    );
  }
  return parsed;
}

/**
 * Parse integer-only options, rejecting fractions and malformed input.
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

/** Numeric contracts reuse the same field schemas as command execution. */
interface NumericOptionRule {
  schema?: ZodTypeAny;
  integerOnly?: boolean;
}

/** Options validated before policy effects and again by directly invoked handlers. */
const NUMERIC_COMMAND_OPTIONS: Readonly<
  Record<string, Readonly<Record<string, NumericOptionRule>>>
> = {
  build: { jobs: { schema: BuildProjectParamsSchema.shape.jobs } },
  // These two legacy commands accept finite fractions and have no field schema.
  monitor: { timeout: {} },
  approvals: { limit: {} },
  "monitor-health": {
    "baud-rate": { schema: AgentMonitorHealthParamsSchema.shape.baudRate },
    duration: {
      schema: AgentMonitorHealthParamsSchema.shape.captureDurationSeconds,
    },
    "max-bytes": { schema: AgentMonitorHealthParamsSchema.shape.maxBytes },
    "failure-threshold": {
      schema: AgentMonitorHealthParamsSchema.shape.failureThreshold,
    },
  },
  "target-resolve": {
    "binding-ttl": {
      schema: AgentResolveTargetParamsSchema.shape.bindingTtlSeconds,
    },
  },
  "agent-flash-monitor-verify": {
    timeout: {
      schema: AgentFlashMonitorVerifyParamsSchema.shape.timeoutSeconds,
    },
    "stability-window": {
      schema: AgentFlashMonitorVerifyParamsSchema.shape.stabilityWindowSeconds,
    },
  },
  "pending-approvals": {
    limit: { schema: ListPendingApprovalsParamsSchema.shape.limit },
  },
  "task-history": {
    limit: { schema: ListTaskHistoryParamsSchema.shape.limit },
  },
  "logs query": {
    lines: { integerOnly: true, schema: QueryLogsParamsSchema.shape.lines },
  },
  "logs capture": {
    "baud-rate": {
      integerOnly: true,
      schema: CaptureSerialWindowParamsSchema.shape.baudRate,
    },
    duration: {
      integerOnly: true,
      schema: CaptureSerialWindowParamsSchema.shape.durationSeconds,
    },
    "max-bytes": {
      integerOnly: true,
      schema: CaptureSerialWindowParamsSchema.shape.maxBytes,
    },
  },
  "lib search": {
    limit: {
      integerOnly: true,
      schema: SearchLibrariesParamsSchema.shape.limit,
    },
  },
  dashboard: { port: { integerOnly: true } },
};

/** Validate present numeric flags without changing the original authorization arguments. */
export function validateNumericCommandOptions(
  command: string,
  options: Readonly<Record<string, OptionValue>>,
  positionals: readonly string[] = [],
): void {
  // Serial --port values are strings everywhere except dashboard serve mode.
  if (command === "dashboard" && asBoolean(options.serve) !== true) return;
  const key =
    command === "logs" || command === "lib"
      ? `${command} ${positionals[0]}`
      : command;
  for (const [name, rule] of Object.entries(
    NUMERIC_COMMAND_OPTIONS[key] ?? {},
  )) {
    const value = rule.integerOnly
      ? parseNumberOption(options[name], name)
      : asNumber(options[name], name);
    if (value === undefined || !rule.schema) continue;
    const result = rule.schema.safeParse(value);
    if (!result.success) {
      throw new PlatformIOError(
        `--${name}: ${result.error.issues[0]?.message ?? "Invalid numeric value"}`,
        "INVALID_ARGUMENT",
        { argument: name, value: options[name] },
      );
    }
  }
}

/** Split a supplied comma-delimited string into nonempty items. */
export function asCsv(value: OptionValue | undefined): string[] | undefined {
  if (typeof value !== "string") return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

/** Treat the automatic port selector as an omitted explicit port. */
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
