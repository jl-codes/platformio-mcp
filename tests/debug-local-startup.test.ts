/** Local composition binds startup identity and retains one authorized inventory refresh for probe handoff. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  startLocalPreparedDebugger,
  type LocalDebuggerStartup,
} from "../src/core/debug/debug-local-startup.js";
import { startPreparedDebugger } from "../src/core/debug/debug-startup.js";
import { prepareLocalDebugBackend } from "../src/core/debug/debug-backend-selection.js";
import { DebugClientSessions } from "../src/core/debug/debug-client-sessions.js";
import { DeviceLeaseStore } from "../src/core/devices/device-lease.js";
import { selectDebugProbe } from "../src/core/devices/debug-probe.js";
vi.mock("../src/core/debug/debug-startup.js", () => ({
  startPreparedDebugger: vi.fn(),
}));
vi.mock("../src/core/debug/debug-backend-selection.js", () => ({
  prepareLocalDebugBackend: vi.fn(),
}));
let root: string;
const probe = {
  vendorId: "1366",
  productId: "0101",
  serialNumber: "580011111",
  location: "usb:1",
};
beforeEach(() => {
  root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "pio-local-start-")),
  );
  vi.resetAllMocks();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function fixture() {
  const store = new DeviceLeaseStore({
    root: path.join(root, "leases"),
    inspect: () => ({
      status: "running",
      identity: {
        pid: process.pid,
        platform: process.platform,
        startToken: "fixture",
      },
    }),
  });
  const input = {
    prepared: {
      projectDir: root,
      environment: "debug",
      load: false,
      elfPath: path.join(root, "firmware.elf"),
      expectedElfSha256: "a".repeat(64),
      executable: path.join(root, "gdb"),
      trustedDebuggerRoots: [root],
      configuration: { generatedInitTemplate: "monitor reset halt\n" },
    },
    readInventory: vi.fn(async () => [probe]),
    confirmProbeReleased: vi.fn(async () => true),
    timeoutMs: 1000,
    leaseStore: store,
  } as unknown as LocalDebuggerStartup;
  vi.mocked(prepareLocalDebugBackend).mockResolvedValue({
    options: {
      pythonExecutable: "host-python",
      command: { executable: "host-backend", cwd: root, arguments: [] },
    },
    readyPattern: "Listening",
    endpoint: { host: "127.0.0.1", port: 3333 },
    ...selectDebugProbe([probe]),
  });
  return { input, store, resource: selectDebugProbe([probe]).resource };
}
it("defers custody until startup requests it and refreshes discovery only at handoff", async () => {
  const { input, store, resource } = fixture();
  vi.mocked(startPreparedDebugger).mockImplementation(
    async (_sessions, selection) => {
      expect(store.status(resource).status).toBe("unclaimed");
      expect(selection.probeIdentity).toContain(probe.location);
      expect(selection.probeIdentity).toContain(probe.serialNumber);
      expect(selection.initialization?.template).toBe("monitor reset halt\n");
      const owned = await selection.acquireCustody();
      expect(store.status(resource).status).toBe("owned");
      await owned.custody.prepareSpawn();
      expect(input.readInventory).toHaveBeenCalledTimes(2);
      expect(owned.confirmProbeReleased).toBe(input.confirmProbeReleased);
      owned.custody.releaseAfterExit();
      return "session";
    },
  );
  expect(
    await startLocalPreparedDebugger(new DebugClientSessions(), input),
  ).toBe("session");
  expect(store.status(resource).status).toBe("unclaimed");
});
it("does not acquire a lease when startup preflight requires approval", async () => {
  const { input, store, resource } = fixture();
  vi.mocked(startPreparedDebugger).mockRejectedValue(
    new Error("approval required"),
  );
  await expect(
    startLocalPreparedDebugger(new DebugClientSessions(), input),
  ).rejects.toThrow("approval required");
  expect(input.readInventory).toHaveBeenCalledTimes(1);
  expect(store.status(resource).status).toBe("unclaimed");
});
it("rejects a changed physical location at handoff and permits owned cleanup", async () => {
  const { input, store, resource } = fixture();
  vi.mocked(input.readInventory)
    .mockResolvedValueOnce([probe])
    .mockResolvedValueOnce([{ ...probe, location: "usb:2" }]);
  vi.mocked(startPreparedDebugger).mockImplementation(
    async (_sessions, selection) => {
      const owned = await selection.acquireCustody();
      await expect(owned.custody.prepareSpawn()).rejects.toMatchObject({
        code: "DEBUG_PROBE_CHANGED",
      });
      owned.custody.releaseAfterExit();
      return "failed-cleaned";
    },
  );
  await startLocalPreparedDebugger(new DebugClientSessions(), input);
  expect(store.status(resource).status).toBe("unclaimed");
});
