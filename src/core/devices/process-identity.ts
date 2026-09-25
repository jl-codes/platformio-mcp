/**
 * OS-backed process start identity for physical-device lease ownership.
 * Provides inspectProcessIdentity and compareProcessIdentity without terminating processes.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PlatformIOError } from "../../utils/errors.js";

/** An identity is deliberately separate from a PID and a lease's random nonce. */
export interface ProcessIdentity {
  pid: number;
  platform: NodeJS.Platform;
  startToken: string;
}
/** Unknown observations never prove that a lease is stale. */
export type ProcessObservation =
  | { status: "running"; identity: ProcessIdentity }
  | { status: "absent" }
  | { status: "unknown" };

/** Parse Linux stat after the last closing parenthesis; process names can contain spaces/parentheses. */
export function linuxStartToken(
  stat: string,
  bootId: string,
  pid: number,
): string {
  const end = stat.lastIndexOf(")");
  const fields = stat
    .slice(end + 1)
    .trim()
    .split(/\s+/);
  const start = fields[19]; // The suffix begins with field 3; starttime is field 22.
  if (
    stat.length > 8192 ||
    end < 0 ||
    !stat.startsWith(`${pid} (`) ||
    !/^[0-9]+$/.test(start ?? "") ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(bootId.trim())
  )
    throw new PlatformIOError(
      "Invalid Linux process identity.",
      "PROCESS_IDENTITY_INVALID",
    );
  return `${bootId.trim().toLowerCase()}:${start}`;
}

/** Read identity using OS process metadata, with bounded external-command output and time. */
export function inspectProcessIdentity(pid: number): ProcessObservation {
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647)
    throw new PlatformIOError(
      "Invalid process ID.",
      "PROCESS_IDENTITY_INVALID",
    );
  try {
    let startToken: string;
    if (process.platform === "linux") {
      startToken = linuxStartToken(
        fs.readFileSync(`/proc/${pid}/stat`, "utf8"),
        fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8"),
        pid,
      );
    } else if (process.platform === "win32") {
      const systemRoot = process.env.SystemRoot;
      if (!systemRoot || !path.isAbsolute(systemRoot))
        return { status: "unknown" };
      // The only substituted value is a validated positive integer, never caller-supplied code.
      startToken = execFileSync(
        path.join(
          systemRoot,
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$ErrorActionPreference='Stop'; [System.Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToFileTimeUtc().ToString([System.Globalization.CultureInfo]::InvariantCulture)`,
        ],
        {
          encoding: "utf8",
          // Windows PowerShell cold startup can exceed three seconds on loaded hosts.
          timeout: 10000,
          maxBuffer: 8192,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ).trim();
      if (!/^[0-9]{15,20}$/.test(startToken)) return { status: "unknown" };
    } else if (process.platform === "darwin") {
      startToken = execFileSync(
        "/bin/ps",
        ["-p", String(pid), "-o", "lstart="],
        {
          encoding: "utf8",
          timeout: 3000,
          maxBuffer: 8192,
          env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      ).trim();
      if (
        !/^[A-Z][a-z]{2} [A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/.test(
          startToken,
        )
      )
        return { status: "unknown" };
      // ps has second precision: an equal token conservatively keeps ownership, even on rapid PID reuse.
    } else return { status: "unknown" };
    return {
      status: "running",
      identity: { pid, platform: process.platform, startToken },
    };
  } catch {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH")
        return { status: "absent" };
    }
    return { status: "unknown" };
  }
}

/** A changed OS start identity or proven missing PID is stale; access errors are not. */
export function compareProcessIdentity(
  owner: ProcessIdentity,
  observation: ProcessObservation,
): "alive" | "stale" | "unknown" {
  if (observation.status === "absent") return "stale";
  if (observation.status === "unknown") return "unknown";
  if (
    owner.platform !== observation.identity.platform ||
    owner.pid !== observation.identity.pid
  )
    return "unknown";
  return owner.startToken === observation.identity.startToken
    ? "alive"
    : "stale";
}
