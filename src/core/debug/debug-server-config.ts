/** Normalize PlatformIO-resolved debug server commands without granting executable or probe trust. */
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";

/** Resolved command is still subject to host execution permission, installation trust and probe custody. */
export interface DebugServerCommand {
  executable: string;
  cwd: string;
  arguments: string[];
}

/** Parse the resolved server object produced by PlatformIO DebugConfigBase, preserving argument boundaries. */
export function parseDebugServerCommand(
  input: unknown,
  projectDir: string,
): DebugServerCommand | null {
  const invalid = (): never => {
    throw new PlatformIOError(
      "Invalid resolved debug-server configuration.",
      "DEBUG_SERVER_CONFIG_INVALID",
    );
  };
  if (!path.isAbsolute(projectDir) || /[\x00-\x1f\x7f]/.test(projectDir))
    invalid();
  if (input === null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input))
    return invalid();
  const record = input as Record<string, unknown>;
  const boundedString = (value: unknown, maximum: number): value is string =>
    typeof value === "string" &&
    Buffer.byteLength(value) <= maximum &&
    !/[\x00-\x1f\x7f]/.test(value);
  const cwd = record.cwd == null ? projectDir : record.cwd;
  if (!boundedString(cwd, 32768) || !path.isAbsolute(cwd)) return invalid();
  if (
    !boundedString(record.executable, 32768) ||
    !record.executable.trim() ||
    /\.(?:cmd|bat|ps1|sh)$/i.test(record.executable)
  )
    return invalid();
  if (
    !Array.isArray(record.arguments) ||
    record.arguments.length > 256 ||
    record.arguments.some((argument) => !boundedString(argument, 32768))
  )
    return invalid();
  const arguments_ = record.arguments as string[];
  if (
    arguments_.reduce(
      (size, argument) => size + Buffer.byteLength(argument),
      0,
    ) >
    128 * 1024
  )
    return invalid();
  // Relative package executables resolve against the package cwd, never a shell/PATH lookup.
  if (!path.isAbsolute(record.executable) && record.cwd == null)
    return invalid();
  return {
    executable: path.resolve(cwd, record.executable),
    cwd: path.normalize(cwd),
    arguments: [...arguments_],
  };
}
