/** CLI translation for bounded serial capture and memory telemetry. */
import { MemoryWatchCompatibilitySchema } from "./memory-compat.js";
import { MonitorCaptureCompatibilitySchema } from "./monitor-start-compat.js";
import { PlatformIOError } from "../utils/errors.js";
/** Reuse shared schemas and never accept another connection's session ID. */
export function parseSerialObservationCli(
  command: "monitor-capture" | "memory-watch",
  options: Record<string, string | boolean>,
  positionals: readonly string[],
  projectDir?: string,
) {
  const invalid = () =>
    new PlatformIOError(
      "Invalid serial observation arguments.",
      "SERIAL_CLI_ARGUMENT_INVALID",
    );
  const strings: Record<string, string> = {
    port: "port",
    environment: "env",
    ...(command === "memory-watch"
      ? { pattern: "pattern", "stack-unit": "stack_unit" }
      : { until: "until" }),
  };
  const numbers: Record<string, string> = {
    baud: "baud",
    seconds: "seconds",
    "max-lines": "max_lines",
    ...(command === "memory-watch"
      ? {
          "stack-warn-bytes": "stack_warn_bytes",
          "stack-word-bytes": "stack_word_bytes",
        }
      : {}),
  };
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
  for (const key of ["json", "approve"])
    if (
      options[key] !== undefined &&
      ![true, false, "true", "false"].includes(options[key])
    )
      throw invalid();
  const input: Record<string, unknown> = { project_dir: projectDir };
  for (const [flag, key] of Object.entries(strings)) {
    if (options[flag] === undefined) continue;
    if (typeof options[flag] !== "string") throw invalid();
    input[key] = options[flag];
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
  const schema =
    command === "memory-watch"
      ? MemoryWatchCompatibilitySchema
      : MonitorCaptureCompatibilitySchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid();
  if (input.stack_unit === "words" && input.stack_word_bytes === undefined)
    throw invalid();
  return parsed.data;
}
