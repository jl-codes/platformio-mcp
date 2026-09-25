/** Bind a trusted OpenOCD command to the selected USB serial and a local GDB endpoint. */
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";
import {
  selectDebugProbe,
  type UsbProbeRecord,
} from "../devices/debug-probe.js";
import {
  parseDebugServerCommand,
  type DebugServerCommand,
} from "./debug-server-config.js";

/** Encode one Tcl word without permitting variable, command, or backslash substitution. */
function tclWord(value: string): string {
  return (
    '"' + value.replace(/[\\"$\[\]]/g, (character) => "\\" + character) + '"'
  );
}

/** Local backends must expose a concrete TCP port; remote and pipe transports need a different custody path. */
export function selectLocalDebugEndpoint(value: string | null) {
  const match = /^(?:(?:127\.0\.0\.1|localhost)?):([0-9]{1,5})$/.exec(
    value ?? "",
  );
  const port = match ? Number(match[1]) : 0;
  if (port < 1 || port > 65535)
    throw new PlatformIOError(
      "A loopback TCP debug endpoint is required for an owned local backend.",
      "DEBUG_ENDPOINT_UNSUPPORTED",
    );
  return Object.freeze({ host: "127.0.0.1", port });
}

/** Add OpenOCD's documented serial selector before config loading and reaffirm it before automatic init. */
export function bindOpenOcdProbe(
  command: DebugServerCommand,
  selected: UsbProbeRecord,
  port: number,
): DebugServerCommand {
  const normalized = parseDebugServerCommand(command, command.cwd)!;
  if (!/^openocd(?:\.exe)?$/i.test(path.basename(normalized.executable)))
    throw new PlatformIOError(
      "This probe binding requires a trusted OpenOCD backend.",
      "DEBUG_BACKEND_BINDING_UNSUPPORTED",
    );
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new PlatformIOError(
      "Invalid backend GDB port.",
      "DEBUG_ENDPOINT_UNSUPPORTED",
    );
  const probe = selectDebugProbe([selected]).probe;
  const binding = [
    "-c",
    "adapter serial " + tclWord(probe.serialNumber),
    "-c",
    "bindto 127.0.0.1",
    "-c",
    "gdb_port " + port,
    "-c",
    "tcl_port disabled",
    "-c",
    "telnet_port disabled",
  ];
  // Do not accept explicit initialization or a competing selector before the final binding.
  // Config files themselves are trusted executable Tcl under the separate host-code grant.
  for (let index = 0; index < normalized.arguments.length; index++) {
    const option = normalized.arguments[index];
    if (
      option.startsWith("-c") ||
      option === "--command" ||
      option.startsWith("--command=")
    ) {
      const text = option.startsWith("--command=")
        ? option.slice(10)
        : option.startsWith("-c") && option.length > 2
          ? option.slice(2)
          : normalized.arguments[++index];
      if (
        text === undefined ||
        /(?:^|[;\n])\s*(?:init|reset|halt|resume|program|flash|adapter\s+serial|ftdi_serial|hla_serial|cmsis_dap_serial|jlink\s+serial|st-link\s+serial)(?:\s|$)/i.test(
          text,
        )
      )
        throw new PlatformIOError(
          "Backend arguments initialize hardware early or contain a competing probe selector.",
          "DEBUG_BACKEND_BINDING_CONFLICT",
        );
    }
  }
  return {
    ...normalized,
    arguments: [...binding, ...normalized.arguments, ...binding],
  };
}
