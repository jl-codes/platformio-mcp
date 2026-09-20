/** Strict CLI translation into the shared flash verifier, preserving every scoped approval. */
import { FlashVerificationCompatibilitySchema } from "./flash-verification-compat.js";
import { PlatformIOError } from "../utils/errors.js";

const STRING_OPTIONS = {
  environment: "env",
  "upload-port": "upload_port",
  "monitor-port": "monitor_port",
  expect: "expect",
  "fail-on": "fail_on",
  "approval-id": "approval_id",
  "workflow-approval-id": "workflow_approval_id",
  "config-approval-id": "config_approval_id",
  "selection-approval-id": "selection_approval_id",
  "monitor-approval-id": "monitor_approval_id",
  "read-approval-id": "read_approval_id",
  "preflight-discovery-approval-id": "preflight_discovery_approval_id",
  "discovery-approval-id": "discovery_approval_id",
  "decode-approval-id": "decode_approval_id",
  "decode-config-approval-id": "decode_config_approval_id",
} as const;
const NUMBER_OPTIONS = {
  baud: "baud",
  timeout: "timeout_s",
  "max-lines": "max_lines",
  settle: "settle_s",
  "stability-window": "stability_window_s",
} as const;

/** Reject unknown or valueless flags before project discovery or firmware effects. */
export function parseFlashVerificationCli(
  options: Record<string, string | boolean>,
  positionals: readonly string[],
  projectDir: string | undefined,
) {
  const invalid = () =>
    new PlatformIOError(
      "Invalid flash-verify option or value.",
      "FLASH_VERIFY_INPUT_INVALID",
    );
  if (!projectDir) throw invalid();
  const allowed = new Set([
    "json",
    "project-dir",
    "stop-open-sessions",
    ...Object.keys(STRING_OPTIONS),
    ...Object.keys(NUMBER_OPTIONS),
  ]);
  if (
    positionals.length ||
    Object.keys(options).some((key) => !allowed.has(key))
  )
    throw invalid();
  if (
    options["project-dir"] !== undefined &&
    typeof options["project-dir"] !== "string"
  )
    throw invalid();
  const input: Record<string, unknown> = { project_dir: projectDir };
  for (const [flag, key] of Object.entries(STRING_OPTIONS)) {
    const value = options[flag];
    if (value === undefined) continue;
    if (typeof value !== "string") throw invalid();
    input[key] = value;
  }
  for (const [flag, key] of Object.entries(NUMBER_OPTIONS)) {
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
  const stop = options["stop-open-sessions"];
  if (stop !== undefined && ![true, false, "true", "false"].includes(stop))
    throw invalid();
  input.stop_open_sessions = stop === true || stop === "true";
  const parsed = FlashVerificationCompatibilitySchema.safeParse(input);
  if (!parsed.success) throw invalid();
  return parsed.data;
}
