/** Public flash workflow integration with real policy/leases and simulated upload/serial devices. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SerialPortMock } from "serialport";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { executeFlashVerification } from "../src/tools/flash-verification.js";
import { SerialClientContext } from "../src/adapters/serial-client.js";
import { PolicySerialSessionService } from "../src/core/serial/session-policy.js";
import { DirectSerialTransport } from "../src/core/serial/serial-transport.js";
import { DeviceLeaseStore } from "../src/core/devices/device-lease.js";
import { resolveSerialEndpoint } from "../src/core/devices/serial-endpoint.js";
import { buildTarget } from "../src/tools/build.js";

vi.mock("../src/tools/build.js", () => ({ buildTarget: vi.fn() }));
vi.mock("../src/utils/lock-manager.js", () => ({
  hardwareLockManager: {
    withImplicitLock: (run: () => Promise<unknown>) => run(),
  },
}));
vi.mock("../src/utils/command-log.js", () => ({
  readCommandOutput: vi.fn(async () => "completed"),
  retainCommandLog: vi.fn(async () => "retained.log"),
}));
vi.mock("../src/core/devices/serial-endpoint.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../src/core/devices/serial-endpoint.js")
    >();
  return {
    ...original,
    resolveSerialEndpoint: (port: string) =>
      original.resolveSerialEndpoint(port, { platform: "win32" }),
  };
});
let root: string;
let client: SerialClientContext;
beforeEach(() => {
  root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "pio-flash-custody-"),
  );
  vi.stubEnv("PIO_MCP_DATA_DIR", path.join(root, "operator"));
  vi.stubEnv("PIO_MCP_POLICY_FILE", path.join(root, "operator.json"));
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({ profile: "lab_admin" }),
  );
  fs.writeFileSync(
    path.join(root, "platformio.ini"),
    "[env:native]\nplatform=native\n",
  );
  vi.mocked(buildTarget).mockReset();
});
afterEach(async () => {
  await client?.close();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it.each(["success", "upload-failed", "disconnect"])(
  "holds the selected device throughout public flash verification: %s",
  async (outcome) => {
    const leases = new DeviceLeaseStore({
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
    const resource = resolveSerialEndpoint("COM42").resource;
    const held = () => expect(() => leases.acquire(resource)).toThrow();
    let uploaderClosed = false;
    const transport = vi.fn(async (options, onData) => {
      expect(uploaderClosed).toBe(true);
      held();
      SerialPortMock.binding.createPort(options.path, {
        echo: true,
        record: true,
      });
      return new DirectSerialTransport(
        new SerialPortMock({
          path: options.path,
          baudRate: options.baudRate,
          autoOpen: false,
        }),
        options,
        onData,
      );
    });
    const discovery = vi.fn(async () => [
      {
        path: "COM42",
        vendorId: "10c4",
        productId: "ea60",
        serialNumber: "test-board",
      },
    ]);
    const service = new PolicySerialSessionService({
      leases,
      transport,
      resolveEndpoint: resolveSerialEndpoint,
      discoveryLoad: async () => ({ list: discovery }),
    });
    client = new SerialClientContext(service);
    vi.mocked(buildTarget).mockImplementationOnce(
      async (_project, _target, _env, _verbose, execution) => {
        expect(execution?.deviceCustody).toBeDefined();
        expect(transport).not.toHaveBeenCalled();
        held();
        await execution!.deviceCustody!.prepareSpawn();
        held();
        if (outcome === "disconnect") {
          const stopped = await client.close();
          expect(stopped[0].cleanupPending).toBe(true);
          expect(execution!.cancellation!.aborted).toBe(true);
          held();
        }
        uploaderClosed = true;
        execution!.deviceCustody!.releaseAfterExit();
        held();
        await execution?.onResult?.({
          exitCode: outcome === "upload-failed" ? 1 : 0,
          fullLogPath: "upload.log",
          finalOutput: "done",
        });
        return { success: outcome !== "upload-failed", environment: "native" };
      },
    );
    const result = executeFlashVerification(
      {
        projectDir: root,
        environment: "native",
        uploadPort: "COM42",
        monitorPort: "COM42",
        baudRate: 115200,
        verification: {
          timeoutSeconds: 0,
          stabilityWindowSeconds: 0,
          settleSeconds: 0,
        },
      },
      client,
    );
    if (outcome === "disconnect")
      await expect(result).rejects.toMatchObject({ code: "SERIAL_CLOSED" });
    else if (outcome === "upload-failed")
      await expect(result).resolves.toMatchObject({
        ok: false,
        verdict: "upload_failed",
        upload: { ok: false },
      });
    else {
      await expect(result).resolves.toMatchObject({
        upload: { ok: true },
        cleanupPending: false,
      });
      expect(discovery).toHaveBeenCalledTimes(6); // One preflight plus five scoped startup snapshots.
    }
    expect(buildTarget).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledTimes(outcome === "success" ? 1 : 0);
    leases.release(leases.acquire(resource));
  },
);
