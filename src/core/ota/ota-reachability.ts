/** Bounded ICMP observation of an already resolved OTA IPv4 destination. */
import path from "node:path";
import { isIP } from "node:net";
import { runAnalysisProcess } from "../analysis/analysis-process.js";
import { PlatformIOError } from "../../utils/errors.js";

/** ICMP evidence is separate from OTA service availability and runtime health. */
export interface OtaReachability {
  reachable: boolean | null;
  status:
    | "reply"
    | "no_reply"
    | "timeout"
    | "unavailable"
    | "probe_failed"
    | "not_requested";
}

/** Host-only dependencies; public tool requests cannot select executables or arguments. */
export interface OtaReachabilityHost {
  platform: NodeJS.Platform;
  systemRoot?: string;
  run: typeof runAnalysisProcess;
}

/** Probe exactly one pinned IPv4 address without PATH search, a shell, or DNS lookup. */
export async function probeOtaReachability(
  address: string,
  host: OtaReachabilityHost = {
    platform: process.platform,
    systemRoot: process.env.SystemRoot,
    run: runAnalysisProcess,
  },
): Promise<OtaReachability> {
  if (
    isIP(address) !== 4 ||
    Number(address.split(".")[0]) === 0 ||
    Number(address.split(".")[0]) >= 224
  )
    throw new PlatformIOError(
      "ICMP requires a pinned unicast IPv4 destination.",
      "OTA_TARGET_INVALID",
    );
  const windows = host.platform === "win32";
  const executables = windows
    ? host.systemRoot && path.win32.isAbsolute(host.systemRoot)
      ? [path.win32.join(host.systemRoot, "System32", "PING.EXE")]
      : []
    : host.platform === "darwin"
      ? ["/sbin/ping"]
      : host.platform === "linux"
        ? ["/usr/bin/ping", "/bin/ping"]
        : [];
  const args = windows
    ? ["-n", "1", "-w", "1500", address]
    : [
        "-n",
        "-c",
        "1",
        "-W",
        host.platform === "darwin" ? "1500" : "2",
        address,
      ];
  for (const executable of executables) {
    try {
      const result = await host.run(executable, args, {
        timeoutMs: 4500,
        maxOutputBytes: 8192,
        allowedExitCodes: [1, 2],
      });
      // Windows can return zero for an ICMP destination-unreachable response.
      const reply =
        (result.exitCode ?? 0) === 0 &&
        (!windows || /\bTTL=\d+\b/i.test(result.stdout));
      return { reachable: reply, status: reply ? "reply" : "no_reply" };
    } catch (error) {
      if (!(error instanceof PlatformIOError)) throw error;
      if (error.code === "ANALYSIS_TOOL_UNAVAILABLE") continue;
      if (error.code === "ANALYSIS_TIMEOUT")
        return { reachable: false, status: "timeout" };
      return { reachable: null, status: "probe_failed" };
    }
  }
  return { reachable: null, status: "unavailable" };
}
