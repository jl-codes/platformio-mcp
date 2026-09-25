/** Public flash workflow integration with real policy/leases and simulated upload/serial devices. */
import { withInteractiveApprovals } from "../src/core/policy/interactive-approvals.js";
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

const retainedMocks = vi.hoisted(() => ({
  capture: vi.fn(),
  upload: vi.fn(),
  info: vi.fn(),
}));
vi.mock("../src/core/analysis/capture-registered-upload.js", () => ({
  captureRegisteredUpload: retainedMocks.capture,
}));
vi.mock(
  "../src/core/analysis/retained-upload-execution.js",
  async (original) => ({
    ...(await original<
      typeof import("../src/core/analysis/retained-upload-execution.js")
    >()),
    executeRetainedEspUpload: retainedMocks.upload,
  }),
);
vi.mock("../src/tools/projects.js", () => ({
  getSystemInfo: retainedMocks.info,
}));
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
  retainedMocks.capture.mockReset();
  retainedMocks.upload.mockReset();
  retainedMocks.info.mockReset().mockResolvedValue({});
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

it.each(["immediate", "approval-resume", "interactive"])(
  "uses the captured manifest through public flash verification: %s",
  async (mode) => {
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
    let uploaded = false;
    const transport = vi.fn(async (options, onData) => {
      expect(uploaded).toBe(true);
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
    client = new SerialClientContext(
      new PolicySerialSessionService({
        leases,
        transport,
        resolveEndpoint: resolveSerialEndpoint,
        discoveryLoad: async () => ({ list: discovery }),
      }),
    );
    const manifest = {
      projectDir: fs.realpathSync.native(root),
      environment: "native",
      elfCorrespondence: "embedded_hash_match",
      elf: { sha256: "b".repeat(64) },
    };
    const retained = {
      manifest,
      sha256: "a".repeat(64),
      verify: vi.fn().mockResolvedValue(undefined),
    };
    retainedMocks.capture.mockImplementation(async ({ execution }) => {
      held();
      expect(transport).not.toHaveBeenCalled();
      await execution.deviceCustody.prepareSpawn();
      execution.deviceCustody.releaseAfterExit();
      held();
      return { retained, uploader: { port: "COM42" } };
    });
    retainedMocks.upload.mockImplementation(
      async (_retained, _uploader, execution) => {
        expect(_retained).toBe(retained);
        held();
        await execution.custody.prepareSpawn();
        held();
        uploaded = true;
        execution.custody.releaseAfterExit();
        execution.finishCustody();
        held();
        return {
          exitCode: 0,
          output: "done",
          manifestSha256: retained.sha256,
          manifest,
        };
      },
    );
    const request = {
      projectDir: root,
      environment: "native",
      uploadPort: "COM42",
      monitorPort: "COM42",
      baudRate: 115200,
      retainFirmware: true,
      verification: {
        timeoutSeconds: 0,
        stabilityWindowSeconds: 0,
        settleSeconds: 0,
      },
    };
    let resumeId: string | undefined;
    if (mode === "approval-resume") {
      const { PlatformIOError } = await import("../src/utils/errors.js");
      vi.spyOn(client.pendingUploads, "resume").mockRejectedValueOnce(
        new PlatformIOError("approval needed", "APPROVAL_REQUIRED"),
      );
      const failed = await executeFlashVerification(request, client).catch(
        (error) => error,
      );
      expect(failed.code).toBe("APPROVAL_REQUIRED");
      resumeId = failed.context.resumeId;
      expect(resumeId).toMatch(/^[a-f0-9-]{36}$/);
      expect(retainedMocks.upload).not.toHaveBeenCalled();
      leases.release(leases.acquire(resource));
    }
    const confirmations = vi.fn(async () => true);
    if (mode === "interactive") {
      fs.writeFileSync(
        path.join(root, "operator.json"),
        JSON.stringify({
          profile: "lab_admin",
          overrides: {
            approval_required: [
              "flash_verification",
              "upload_firmware",
              "system_info",
              "serial_startup_discovery",
              "list_devices",
              "serial_session_start",
              "serial_session_read",
            ],
          },
        }),
      );
    }
    const run = () =>
      executeFlashVerification({ ...request, resumeId }, client, {
        actor: "user",
      });
    const result =
      mode === "interactive"
        ? await withInteractiveApprovals(confirmations, run)
        : await run();
    if (mode === "interactive") expect(confirmations).toHaveBeenCalled();
    expect(result).toMatchObject({
      upload: { ok: true },
      firmware_identity: "embedded_hash_match",
      upload_manifest_sha256: retained.sha256,
    });
    expect(retainedMocks.capture).toHaveBeenCalledOnce();
    expect(retainedMocks.info).toHaveBeenCalledOnce();
    expect(retainedMocks.upload).toHaveBeenCalledOnce();
    expect(buildTarget).not.toHaveBeenCalled();
    if (mode === "immediate") expect(discovery).toHaveBeenCalledTimes(7);
    leases.release(leases.acquire(resource));
  },
);
