/** Strict CLI argument translation for the shared serial and PPK2 power profiler. */
import { Ppk2CompatibilitySchema } from "./power-meter-client.js";
import { SerialPowerCompatibilitySchema } from "./power-serial-compat.js";
import { PlatformIOError } from "../utils/errors.js";

const strings = {
  source: "source",
  port: "port",
  "dut-port": "dut_port",
  mode: "mode",
  environment: "env",
  pattern: "pattern",
  provenance: "provenance",
  "profile-approval-id": "profile_approval_id",
  "approval-id": "approval_id",
  "config-approval-id": "config_approval_id",
  "selection-approval-id": "selection_approval_id",
  "discovery-approval-id": "discovery_approval_id",
  "read-approval-id": "read_approval_id",
  "host-approval-id": "host_approval_id",
  "power-approval-id": "power_approval_id",
} as const;
const numbers = {
  seconds: "seconds",
  baud: "baud",
  "voltage-mv": "voltage_mv",
  "current-limit-ma": "current_limit_ma",
  buckets: "buckets",
  "sleep-threshold-ma": "sleep_threshold_ma",
  "max-lines": "max_lines",
} as const;

/** Validate every option before clients, discovery or power effects are created. */
export function parsePowerProfileCli(
  options: Record<string, string | boolean>,
  positionals: readonly string[],
  projectDir: string | undefined,
) {
  const invalid = () =>
    new PlatformIOError(
      "Invalid power-profile option or value.",
      "POWER_PROFILE_INPUT_INVALID",
    );
  const allowed = new Set([
    "json",
    "approve",
    "project-dir",
    ...Object.keys(strings),
    ...Object.keys(numbers),
  ]);
  if (
    !projectDir ||
    positionals.length ||
    Object.keys(options).some((key) => !allowed.has(key))
  )
    throw invalid();
  if (
    options.approve !== undefined &&
    ![true, false, "true", "false"].includes(options.approve)
  )
    throw invalid();
  if (
    options["project-dir"] !== undefined &&
    typeof options["project-dir"] !== "string"
  )
    throw invalid();
  const input: Record<string, unknown> = { project_dir: projectDir };
  for (const [flag, key] of Object.entries(strings)) {
    const value = options[flag];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value || value.length > 4096)
      throw invalid();
    input[key] = value;
  }
  for (const [flag, key] of Object.entries(numbers)) {
    const value = options[flag];
    if (value === undefined) continue;
    if (
      typeof value !== "string" ||
      !value.trim() ||
      !Number.isFinite(Number(value))
    )
      throw invalid();
    input[key] = Number(value);
  }
  const { profile_approval_id, ...params } = input;
  if (
    typeof profile_approval_id === "string" &&
    profile_approval_id.length > 256
  )
    throw invalid();
  const parsed = (
    params.source === "ppk2"
      ? Ppk2CompatibilitySchema
      : SerialPowerCompatibilitySchema
  ).safeParse(params);
  if (!parsed.success) throw invalid();
  return {
    ...parsed.data,
    ...(profile_approval_id ? { profile_approval_id } : {}),
  };
}
