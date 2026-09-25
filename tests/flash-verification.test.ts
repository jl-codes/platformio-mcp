/** Verify upload/capture orchestration ordering without opening hardware or executing PlatformIO. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SerialClientContext } from "../src/adapters/serial-client.js";
const upload = vi.hoisted(() => vi.fn());
vi.mock("../src/adapters/upload-compat.js", () => ({
  executeUploadCompatibility: upload,
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
import { PlatformIOError } from "../src/utils/errors.js";
import { executeFlashVerification } from "../src/tools/flash-verification.js";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "pio-flash-verify-"),
  );
  vi.stubEnv("PIO_MCP_DATA_DIR", path.join(root, "operator"));
  vi.stubEnv("PIO_MCP_POLICY_FILE", path.join(root, "operator.json"));
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({ profile: "lab_admin" }),
  );
  upload.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const order: string[] = [];
  const service = {
    preflightVerificationCapture: vi.fn(async () => {
      order.push("preflight");
      return { port: "COM42", deviceBinding: "bound-device" };
    }),
    captureVerificationOnce: vi.fn(async (...args) => {
      order.push("reserved");
      try {
        await args[5]({
          sessionId: "reserved-monitor",
          signal: new AbortController().signal,
          custody: { prepareSpawn: vi.fn(), releaseAfterExit: vi.fn() },
        });
      } catch (error) {
        throw new PlatformIOError(error.message, error.code, {
          cleanupPending: false,
        });
      }
      order.push("capture");
      return { ok: true, verdict: "pass", cleanupPending: false };
    }),
    sessions: { list: vi.fn(() => []), stop: vi.fn() },
  };
  const client = {
    run: async (
      _context: unknown,
      execute: (service: unknown, owner: unknown) => Promise<unknown>,
    ) => execute(service, {}),
  } as unknown as SerialClientContext;
  upload.mockImplementation(
    async (
      _args,
      _client,
      _defaults,
      _caller,
      authorized,
      _reserved,
      around,
    ) => {
      order.push("upload-authorized");
      await authorized();
      await around(async () => {
        order.push("uploaded");
        return true;
      });
      return { ok: true };
    },
  );
  const input = {
    projectDir: root,
    environment: "esp32",
    uploadPort: "COM42",
    monitorPort: "COM42",
    baudRate: 115200,
    verification: { timeoutSeconds: 0, stabilityWindowSeconds: 0 },
  };
  return { service, order, run: () => executeFlashVerification(input, client) };
}
it("plans before upload and binds subsequent capture to the preflight device", async () => {
  const f = fixture();
  expect(await f.run()).toMatchObject({
    ok: true,
    verdict: "pass",
    firmware_identity: "identity_unverified",
  });
  expect(f.order).toEqual([
    "preflight",
    "upload-authorized",
    "reserved",
    "uploaded",
    "capture",
  ]);
  expect(f.service.captureVerificationOnce.mock.calls[0][4]).toBe(
    "bound-device",
  );
});
it("never uploads when monitor preflight denies the request", async () => {
  const f = fixture();
  f.service.preflightVerificationCapture.mockRejectedValueOnce(
    new Error("denied"),
  );
  await expect(f.run()).rejects.toThrow("denied");
  expect(upload).not.toHaveBeenCalled();
  expect(f.service.captureVerificationOnce).not.toHaveBeenCalled();
});
it("does not open a monitor after upload failure", async () => {
  const f = fixture();
  upload.mockResolvedValueOnce({ ok: false });
  expect(await f.run()).toMatchObject({ ok: false, verdict: "upload_failed" });
  expect(f.service.captureVerificationOnce).not.toHaveBeenCalled();
});

it.each([
  "pio_flash_and_verify",
  "agent_flash_monitor_verify",
  "upload_firmware",
])(
  "honors concrete or ancestor denial for %s before upload",
  async (denied) => {
    const f = fixture();
    fs.writeFileSync(
      path.join(root, "operator.json"),
      JSON.stringify({ profile: "lab_admin", overrides: { deny: [denied] } }),
    );
    await expect(f.run()).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(upload).not.toHaveBeenCalled();
    expect(f.service.preflightVerificationCapture).not.toHaveBeenCalled();
  },
);
