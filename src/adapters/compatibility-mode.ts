/** Strict opt-in compatibility launch parsing, independent of policy and tool registration. */
import { PlatformIOError } from "../utils/errors.js";

/** The single pinned reference vocabulary supported by the implementation plan. */
export type CompatibilityMode = "platformio-mcp-python";
/** Parsed launch options; remaining arguments retain their original order. */
export interface CompatibilityLaunch {
  mode?: CompatibilityMode;
  args: string[];
}

/** Parse a launch-owned flag/environment selection without changing host or server permissions. */
export function parseCompatibilityLaunch(
  args: readonly string[],
  environment: string | undefined = process.env.PIO_MCP_COMPAT,
): CompatibilityLaunch {
  let selected: string | undefined;
  const remaining: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--") {
      remaining.push(...args.slice(index));
      break;
    }
    if (argument !== "--compat" && !argument.startsWith("--compat=")) {
      remaining.push(argument);
      continue;
    }
    const value =
      argument === "--compat"
        ? args[++index]
        : argument.slice("--compat=".length);
    if (!value || value.startsWith("--"))
      throw invalid("--compat requires a mode.");
    if (selected !== undefined) throw invalid("Specify --compat only once.");
    selected = value;
  }
  for (const value of [selected, environment]) {
    if (value !== undefined && value !== "platformio-mcp-python")
      throw invalid(
        "Unsupported compatibility mode; expected platformio-mcp-python.",
      );
  }
  if (
    selected !== undefined &&
    environment !== undefined &&
    selected !== environment
  )
    throw invalid("Conflicting compatibility flag and environment settings.");
  return {
    mode: (selected ?? environment) as CompatibilityMode | undefined,
    args: remaining,
  };
}

/** Keep all malformed launch choices explicit rather than falling back to permissive behavior. */
function invalid(message: string): PlatformIOError {
  return new PlatformIOError(message, "COMPAT_CONFIG_INVALID");
}
