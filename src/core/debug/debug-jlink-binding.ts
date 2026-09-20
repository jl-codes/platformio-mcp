/** Bind a modern SEGGER GDB server to an explicitly selected USB probe and loopback GDB port. */
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

/** Use SEGGER's -USB selector (V8.24+); preserve target setup and separately authorized scripts. */
export function bindJLinkProbe(
  command: DebugServerCommand,
  selected: UsbProbeRecord,
  port: number,
): DebugServerCommand {
  const normalized = parseDebugServerCommand(command, command.cwd)!;
  const conflict = (): never => {
    throw new PlatformIOError(
      "J-Link arguments conflict with the selected USB probe or local endpoint.",
      "DEBUG_BACKEND_BINDING_CONFLICT",
    );
  };
  if (
    !/^JLinkGDBServer(?:CL)?(?:Exe)?(?:\.exe)?$/i.test(
      path.basename(normalized.executable),
    )
  )
    throw new PlatformIOError(
      "J-Link probe binding requires a trusted SEGGER GDB server.",
      "DEBUG_BACKEND_BINDING_UNSUPPORTED",
    );
  const probe = selectDebugProbe([selected]).probe;
  // 0..3 select legacy device indices, not a uniquely identified probe.
  if (
    !/^[0-9]{1,12}$/.test(probe.serialNumber) ||
    Number(probe.serialNumber) <= 3 ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    return conflict();
  const args: string[] = [];
  for (let index = 0; index < normalized.arguments.length; index++) {
    const argument = normalized.arguments[index];
    const option = argument.toLowerCase();
    if (
      option === "-ip" ||
      option.startsWith("-ip=") ||
      option === "-nolocalhostonly"
    )
      return conflict();
    if (["-usb", "-select", "-port", "-localhostonly"].includes(option)) {
      const next = normalized.arguments[index + 1];
      // LocalhostOnly accepts an omitted state, unlike the other managed options.
      if (
        option === "-localhostonly" &&
        (next === undefined || next.startsWith("-"))
      )
        continue;
      if (next === undefined || next.startsWith("-")) return conflict();
      index++;
      if (option === "-usb" && next !== probe.serialNumber) return conflict();
      if (
        option === "-select" &&
        next.toUpperCase() !== "USB" &&
        next !== "USB=" + probe.serialNumber
      )
        return conflict();
      if (option === "-localhostonly" && next !== "1") return conflict();
      if (option === "-port" && !/^[0-9]{1,5}$/.test(next)) return conflict();
      continue;
    }
    if (/^-(?:usb|select|port|localhostonly)=/i.test(argument))
      return conflict();
    args.push(argument);
  }
  return parseDebugServerCommand(
    {
      ...normalized,
      arguments: [
        ...args,
        "-USB",
        probe.serialNumber,
        "-port",
        String(port),
        "-LocalhostOnly",
        "1",
      ],
    },
    normalized.cwd,
  )!;
}
