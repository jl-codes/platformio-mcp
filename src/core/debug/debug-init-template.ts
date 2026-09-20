/** Bind Core-preserved initialization placeholders to retained program storage and an owned endpoint. */
import path from "node:path";
import { isIP } from "node:net";
import { PlatformIOError } from "../../utils/errors.js";

/** Reserved placeholders emitted only by the installed-Core resolver bridge. */
export const DEBUG_INIT_MARKERS = Object.freeze({
  elf: "__PIO_MCP_INIT_ELF_PATH__",
  directory: "__PIO_MCP_INIT_ELF_DIRECTORY__",
  endpoint: "__PIO_MCP_INIT_ENDPOINT__",
});

/** Substitute only Core's program/endpoint placeholders; preserve all target-specific GDB commands verbatim. */
export function bindDebugInitializationTemplate(
  template: string,
  selection: { elfPath: string; host: string; port: number },
): string {
  const invalid = (): never => {
    throw new PlatformIOError(
      "Invalid debugger initialization template binding.",
      "DEBUG_INIT_TEMPLATE_INVALID",
    );
  };
  if (
    typeof template !== "string" ||
    !template.trim() ||
    Buffer.byteLength(template) > 65536 ||
    template.includes("\0") ||
    !path.isAbsolute(selection.elfPath) ||
    /[\x00-\x1f\x7f]/.test(selection.elfPath) ||
    !isIP(selection.host) ||
    !Number.isInteger(selection.port) ||
    selection.port < 1 ||
    selection.port > 65535
  )
    return invalid();
  const nativePath = (value: string) =>
    process.platform === "win32" ? value.replace(/\\/g, "/") : value;
  const replacements = [
    [DEBUG_INIT_MARKERS.elf, nativePath(selection.elfPath)],
    [DEBUG_INIT_MARKERS.directory, nativePath(path.dirname(selection.elfPath))],
    [
      DEBUG_INIT_MARKERS.endpoint,
      (isIP(selection.host) === 6
        ? "[" + selection.host + "]"
        : selection.host) +
        ":" +
        selection.port,
    ],
  ];
  if (replacements.some(([, value]) => value.includes("__PIO_MCP_INIT_")))
    return invalid();
  let script = template;
  for (const [marker, value] of replacements)
    script = script.split(marker).join(value);
  if (script.includes("__PIO_MCP_INIT_") || Buffer.byteLength(script) > 65536)
    return invalid();
  return script;
}
