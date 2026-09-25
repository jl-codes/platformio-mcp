/** ICMP commands use fixed OS paths, bounded execution, and truthful observations. */
import { expect, it, vi } from "vitest";
import { probeOtaReachability } from "../src/core/ota/ota-reachability.js";
import { PlatformIOError } from "../src/utils/errors.js";
it.each([
  [
    "win32",
    "C:\\Windows\\System32\\PING.EXE",
    ["-n", "1", "-w", "1500", "192.0.2.8"],
  ],
  ["linux", "/usr/bin/ping", ["-n", "-c", "1", "-W", "2", "192.0.2.8"]],
  ["darwin", "/sbin/ping", ["-n", "-c", "1", "-W", "1500", "192.0.2.8"]],
] as const)("uses fixed %s arguments", async (platform, executable, args) => {
  const run = vi.fn(async () => ({ stdout: "Reply TTL=64", stderr: "" }));
  expect(
    await probeOtaReachability("192.0.2.8", {
      platform,
      systemRoot: "C:\\Windows",
      run,
    }),
  ).toEqual({ reachable: true, status: "reply" });
  expect(run).toHaveBeenCalledWith(executable, args, {
    timeoutMs: 4500,
    maxOutputBytes: 8192,
    allowedExitCodes: [1, 2],
  });
});
it("does not treat Windows destination-unreachable exit zero as a reply", async () => {
  const run = vi.fn(async () => ({
    stdout: "Destination host unreachable.",
    stderr: "",
  }));
  expect(
    await probeOtaReachability("192.0.2.8", {
      platform: "win32",
      systemRoot: "C:\\Windows",
      run,
    }),
  ).toEqual({ reachable: false, status: "no_reply" });
});
it("uses only fixed fallback paths when the system utility is missing", async () => {
  const run = vi.fn(async () => {
    throw new PlatformIOError("missing", "ANALYSIS_TOOL_UNAVAILABLE");
  });
  expect(
    await probeOtaReachability("192.0.2.8", { platform: "linux", run }),
  ).toEqual({ reachable: null, status: "unavailable" });
  expect(run.mock.calls.map((call: unknown[]) => call[0])).toEqual([
    "/usr/bin/ping",
    "/bin/ping",
  ]);
});
it("distinguishes a deadline from an unknown probe failure", async () => {
  for (const [code, reachable, status] of [
    ["ANALYSIS_TIMEOUT", false, "timeout"],
    ["ANALYSIS_TOOL_FAILED", null, "probe_failed"],
  ] as const) {
    const run = vi.fn(async () => {
      throw new PlatformIOError("failed", code);
    });
    expect(
      await probeOtaReachability("192.0.2.8", { platform: "linux", run }),
    ).toEqual({ reachable, status });
  }
});
it.each(["example.com", "-c", "192.0.2.8;id", "::1", "224.0.0.1", "0.0.0.0"])(
  "rejects non-pinned or invalid destination %s",
  async (address) => {
    const run = vi.fn();
    await expect(
      probeOtaReachability(address, { platform: "linux", run }),
    ).rejects.toMatchObject({ code: "OTA_TARGET_INVALID" });
    expect(run).not.toHaveBeenCalled();
  },
);
