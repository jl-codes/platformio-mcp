/** Remote composition uses host binding and supervised startup without opening a network connection. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  startRemotePreparedDebugger,
  type RemoteDebuggerStartup,
} from "../src/core/debug/debug-remote-startup.js";
import { startPreparedDebugger } from "../src/core/debug/debug-startup.js";
import { DebugClientSessions } from "../src/core/debug/debug-client-sessions.js";
import { DeviceLeaseStore } from "../src/core/devices/device-lease.js";
vi.mock("../src/core/debug/debug-startup.js", () => ({
  startPreparedDebugger: vi.fn(),
}));
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-remote-start-"));
  vi.resetAllMocks();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function fixture() {
  const target = {
    prepareSpawn: vi.fn(async () => {}),
    releaseAfterExit: vi.fn(),
  };
  const input = {
    prepared: {
      projectDir: root,
      environment: "debug",
      load: false,
      elfPath: path.join(root, "firmware.elf"),
      expectedElfSha256: "a".repeat(64),
      executable: path.join(root, "gdb"),
      trustedDebuggerRoots: [root],
      configuration: {
        server: null,
        port: "192.0.2.1:3333",
        supervisorPython: path.join(root, "python"),
        generatedInitTemplate: "monitor reset halt\n",
      },
    },
    binding: {
      endpoint: "192.0.2.1:3333",
      identity: "host-resolved-probe",
      acquireTarget: vi.fn(async () => target),
      revalidate: vi.fn(async () => {}),
    },
    timeoutMs: 1000,
    leaseStore: new DeviceLeaseStore({
      root: path.join(root, "leases"),
      inspect: () => ({
        status: "running",
        identity: {
          pid: process.pid,
          platform: process.platform,
          startToken: "fixture",
        },
      }),
    }),
  } as unknown as RemoteDebuggerStartup;
  return { input, target };
}
it("defers target custody until authorized startup and preserves supervised cleanup", async () => {
  const { input, target } = fixture();
  vi.mocked(startPreparedDebugger).mockImplementation(
    async (_sessions, selection) => {
      expect(selection.supervisorPython).toBe(
        input.prepared.configuration.supervisorPython,
      );
      expect(selection.backend).toBeUndefined();
      expect(selection.probeIdentity).toBe(input.binding.identity);
      expect(input.binding.acquireTarget).not.toHaveBeenCalled();
      const owned = await selection.acquireCustody();
      expect(input.binding.acquireTarget).not.toHaveBeenCalled();
      await owned.custody.prepareSpawn();
      expect(input.binding.revalidate).toHaveBeenCalledTimes(2);
      expect(target.prepareSpawn).toHaveBeenCalledOnce();
      owned.custody.releaseAfterExit();
      expect(target.releaseAfterExit).toHaveBeenCalledOnce();
      await expect(selection.acquireCustody()).rejects.toMatchObject({
        code: "DEBUG_CUSTODY_REUSED",
      });
      return "session";
    },
  );
  expect(
    await startRemotePreparedDebugger(new DebugClientSessions(), input),
  ).toBe("session");
});
it("does not acquire or revalidate targets when startup requires approval", async () => {
  const { input } = fixture();
  vi.mocked(startPreparedDebugger).mockRejectedValue(
    new Error("approval required"),
  );
  await expect(
    startRemotePreparedDebugger(new DebugClientSessions(), input),
  ).rejects.toThrow("approval required");
  expect(input.binding.acquireTarget).not.toHaveBeenCalled();
  expect(input.binding.revalidate).not.toHaveBeenCalled();
});
it("rejects mismatched host endpoint before startup", async () => {
  const { input } = fixture();
  input.binding.endpoint = "192.0.2.2:3333";
  await expect(
    startRemotePreparedDebugger(new DebugClientSessions(), input),
  ).rejects.toMatchObject({ code: "DEBUG_REMOTE_BINDING_INVALID" });
  expect(startPreparedDebugger).not.toHaveBeenCalled();
});

it("uses the pinned numeric address for a matching hostname and rejects a different selection", async () => {
  const { input } = fixture();
  input.prepared.configuration.port = "Debug.Example.:3333";
  input.binding.sourceEndpoint = "debug.example:3333";
  vi.mocked(startPreparedDebugger).mockImplementation(
    async (_sessions, selection) => {
      expect(selection.target.host).toBe("192.0.2.1");
      expect(selection.target.port).toBe(3333);
      return "session";
    },
  );
  expect(
    await startRemotePreparedDebugger(new DebugClientSessions(), input),
  ).toBe("session");
  vi.mocked(startPreparedDebugger).mockClear();
  input.binding.sourceEndpoint = "other.example:3333";
  await expect(
    startRemotePreparedDebugger(new DebugClientSessions(), input),
  ).rejects.toMatchObject({ code: "DEBUG_REMOTE_BINDING_INVALID" });
  expect(startPreparedDebugger).not.toHaveBeenCalled();
});
