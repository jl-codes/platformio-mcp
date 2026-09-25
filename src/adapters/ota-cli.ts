/** Strict CLI translation into the shared authorized OTA request schema. */
import { OtaCompatibilitySchema } from "./ota-compat.js";
import { PlatformIOError } from "../utils/errors.js";

const strings = {
  host: "host",
  environment: "env",
  "image-path": "image_path",
  "elf-path": "elf_path",
  "expected-image-sha256": "expected_image_sha256",
  "approval-id": "approval_id",
  "command-approval-id": "command_approval_id",
  "config-approval-id": "config_approval_id",
  "build-approval-id": "build_approval_id",
  "image-approval-id": "image_approval_id",
  "system-approval-id": "system_approval_id",
  "resolve-approval-id": "resolve_approval_id",
} as const;
const numbers = { port: "port", timeout: "timeout_s" } as const;
const booleans = {
  filesystem: "filesystem",
  build: "build",
  "verify-reachable": "verify_reachable",
} as const;

/** Resolve an optional credential from host environment without accepting it in process arguments. */
export function parseOtaCli(
  options: Record<string, string | boolean>,
  positionals: readonly string[],
  projectDir: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const invalid = () =>
    new PlatformIOError(
      "Invalid upload-ota option or value.",
      "OTA_ARGUMENT_INVALID",
    );
  const allowed = new Set([
    "json",
    "approve",
    "project-dir",
    "auth-env",
    ...Object.keys(strings),
    ...Object.keys(numbers),
    ...Object.keys(booleans),
  ]);
  if (
    !projectDir ||
    positionals.length ||
    Object.keys(options).some((key) => !allowed.has(key))
  )
    throw invalid();
  for (const key of ["json", "approve"]) {
    if (
      options[key] !== undefined &&
      ![true, false, "true", "false"].includes(options[key])
    )
      throw invalid();
  }
  if (
    options["project-dir"] !== undefined &&
    typeof options["project-dir"] !== "string"
  )
    throw invalid();
  const input: Record<string, unknown> = { project_dir: projectDir };
  for (const [flag, key] of Object.entries(strings)) {
    const value = options[flag];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value) throw invalid();
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
  for (const [flag, key] of Object.entries(booleans)) {
    const value = options[flag];
    if (value === undefined) continue;
    if (![true, false, "true", "false"].includes(value)) throw invalid();
    input[key] = value === true || value === "true";
  }
  const authEnv = options["auth-env"];
  if (authEnv !== undefined) {
    if (
      typeof authEnv !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(authEnv) ||
      !Object.hasOwn(environment, authEnv) ||
      environment[authEnv] === undefined
    )
      throw invalid();
    input.auth = environment[authEnv];
  }
  const parsed = OtaCompatibilitySchema.safeParse(input);
  if (!parsed.success) throw invalid();
  return parsed.data;
}
