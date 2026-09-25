/**
 * Stable policy source selection independent of writable cache fallbacks.
 *
 * Provides:
 * - configurePolicyFileFromArgs: Consumes the launch-only policy selector.
 * - resolvePolicyFile: Resolves explicit configuration without silent precedence.
 * - resolvePolicyDirectory: Locates operator policy without creating directories.
 */
import os from "node:os";
import path from "node:path";
import { PolicyConfigError } from "./policy-schema.js";

/** Launch selection is process-scoped and cannot be set by a tool argument. */
let launchPolicyFile: string | undefined;

/**
 * Resolves explicit policy selection and rejects conflicting flag/environment values.
 * @param selected - An optional launch flag selection (defaults to this process's selection).
 * @returns Absolute explicit path, or undefined for legacy discovery.
 */
export function resolvePolicyFile(
  selected = launchPolicyFile,
): string | undefined {
  const environment = process.env.PIO_MCP_POLICY_FILE;
  if (environment !== undefined && !environment.trim()) {
    throw new PolicyConfigError(
      "PIO_MCP_POLICY_FILE",
      "The configured path is empty.",
    );
  }
  const flagPath = selected === undefined ? undefined : path.resolve(selected);
  const environmentPath =
    environment === undefined ? undefined : path.resolve(environment);
  if (flagPath && environmentPath && flagPath !== environmentPath) {
    throw new PolicyConfigError(
      "--policy-file / PIO_MCP_POLICY_FILE",
      "Conflicting policy paths; select the same file in both or remove one setting.",
    );
  }
  return flagPath ?? environmentPath;
}

/**
 * Removes policy launch flags before CLI/subcommand routing.
 * @param args - Command-line arguments excluding executable and script.
 * @returns Remaining arguments in their original order.
 */
export function configurePolicyFileFromArgs(args: string[]): string[] {
  const remaining: string[] = [];
  let selected: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--policy-file" || argument.startsWith("--policy-file=")) {
      const value =
        argument === "--policy-file"
          ? args[++index]
          : argument.slice("--policy-file=".length);
      if (!value?.trim() || value.startsWith("--") || selected !== undefined) {
        throw new PolicyConfigError(
          "--policy-file",
          "Supply exactly one non-empty policy file path.",
        );
      }
      selected = value;
    } else {
      remaining.push(argument);
    }
  }
  if (selected !== undefined) launchPolicyFile = resolvePolicyFile(selected);
  return remaining;
}

/**
 * Finds policy storage without probing writable paths or falling back to cwd/temp.
 * An explicit legacy data directory remains supported as an operator-selected location.
 * @returns Stable absolute operator directory.
 */
export function resolvePolicyDirectory(): string {
  const configured = process.env.PIO_MCP_DATA_DIR;
  if (configured !== undefined && !configured.trim()) {
    throw new PolicyConfigError(
      "PIO_MCP_DATA_DIR",
      "The configured directory is empty.",
    );
  }
  return path.resolve(configured ?? path.join(os.homedir(), ".platformio-mcp"));
}
