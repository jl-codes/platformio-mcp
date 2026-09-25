/** Read-only bounded OS port diagnostics; failed process inspection never establishes a free port. */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PlatformIOError } from "../../utils/errors.js";
const execute = promisify(execFile);

/** Parse lsof field output without interpreting command arguments or trusting arbitrary PID text. */
export function parsePortHolders(output: string) {
  const holders: Array<{ pid: number; command: string | null }> = [];
  let current: { pid: number; command: string | null } | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (/^p[1-9][0-9]{0,9}$/.test(line)) {
      const pid = Number(line.slice(1));
      if (
        pid > 2147483647 ||
        pid === process.pid ||
        holders.some((row) => row.pid === pid)
      ) {
        current = undefined;
        continue;
      }
      current = { pid, command: null };
      holders.push(current);
      if (holders.length > 64)
        throw new PlatformIOError(
          "Port holder report exceeds its limit.",
          "PORT_DIAGNOSTICS_LIMIT",
        );
    } else if (line.startsWith("c") && current)
      current.command = line
        .slice(1)
        .replace(/[\x00-\x1f\x7f]/g, "")
        .slice(0, 256);
  }
  return holders;
}

/** Use fixed system executables and argv, never a shell or a caller-selected program. */
async function holders(port: string) {
  for (const command of ["/usr/sbin/lsof", "/usr/bin/lsof"]) {
    try {
      await fs.access(command, fs.constants.X_OK);
      const result = await execute(command, ["-Fpc", "--", port], {
        timeout: 5000,
        maxBuffer: 65536,
        windowsHide: true,
      });
      return {
        held_by_processes: parsePortHolders(result.stdout),
        process_check: "lsof",
        process_check_complete: !result.stderr.trim(),
      };
    } catch (error) {
      const failure = error as {
        code?: string | number;
        stderr?: string;
        stdout?: string;
      };
      if (
        failure.code === 1 &&
        !failure.stderr?.trim() &&
        !failure.stdout?.trim()
      )
        return {
          held_by_processes: [],
          process_check: "lsof",
          process_check_complete: true,
        };
    }
  }
  try {
    await fs.access("/usr/bin/fuser", fs.constants.X_OK);
    const result = await execute("/usr/bin/fuser", ["--", port], {
      timeout: 5000,
      maxBuffer: 65536,
      windowsHide: true,
    });
    if (!/^\s*(?:[1-9][0-9]*\s*)*$/.test(result.stdout))
      throw new Error("Unexpected fuser output");
    const rows = result.stdout
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((pid) => `p${pid}`)
      .join("\n");
    return {
      held_by_processes: parsePortHolders(rows),
      process_check: "fuser",
      process_check_complete: false,
    };
  } catch {
    return {
      held_by_processes: [],
      process_check: "unavailable",
      process_check_complete: false,
    };
  }
}

/** Inspect endpoint metadata and holders without opening, closing, acquiring or reclaiming the device. */
export async function inspectPortDiagnostics(
  port: string,
  listed: boolean | null,
) {
  if (!port || port.length > 512 || /[\x00-\x1f\x7f]/.test(port))
    throw new PlatformIOError("Invalid port name.", "SERIAL_ENDPOINT_INVALID");
  if (process.platform === "win32") {
    if (!/^(?:\\\\\.\\)?COM[1-9][0-9]{0,8}$/i.test(port))
      throw new PlatformIOError(
        "Expected a COM port.",
        "SERIAL_ENDPOINT_INVALID",
      );
    return {
      exists: listed,
      in_device_list: listed,
      permission: null,
      held_by_processes: [],
      process_check: "unavailable",
      process_check_complete: false,
      platform: process.platform,
    };
  }
  if (
    !path.posix.isAbsolute(port) ||
    !path.posix.normalize(port).startsWith("/dev/")
  )
    throw new PlatformIOError(
      "Unix serial ports must be within /dev.",
      "SERIAL_ENDPOINT_INVALID",
    );
  let canonical: string;
  try {
    canonical = await fs.realpath(port);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      exists: missing ? false : null,
      in_device_list: listed,
      permission: null,
      held_by_processes: [],
      process_check: "skipped",
      process_check_complete: false,
      platform: process.platform,
    };
  }
  if (!canonical.startsWith("/dev/"))
    throw new PlatformIOError(
      "Serial alias escapes /dev.",
      "SERIAL_ENDPOINT_INVALID",
    );
  const stat = await fs.stat(canonical);
  if (!stat.isCharacterDevice())
    throw new PlatformIOError(
      "Port is not a character device.",
      "SERIAL_ENDPOINT_INVALID",
    );
  const access = async (mode: number) => {
    try {
      await fs.access(canonical, mode);
      return true;
    } catch {
      return false;
    }
  };
  return {
    exists: true,
    in_device_list: listed,
    permission: {
      readable: await access(fs.constants.R_OK),
      writable: await access(fs.constants.W_OK),
    },
    ...(await holders(canonical)),
    platform: process.platform,
  };
}
