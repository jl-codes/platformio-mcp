/** Reference parameter translation and failure decoding preserve the canonical workflow's result and grants. */
import { beforeEach, expect, it, vi } from "vitest";
import type { SerialClientContext } from "../src/adapters/serial-client.js";
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  execute: vi.fn(),
  decode: vi.fn(),
}));
vi.mock("../src/adapters/compatibility-project.js", () => ({
  resolveCompatibilityProject: async () => "project",
}));
vi.mock("../src/core/policy/revision-guard.js", () => ({
  createPolicyRevisionGuard: () => () => {},
}));
vi.mock("../src/adapters/monitor-start-compat.js", () => ({
  resolveMonitorRequest: mocks.resolve,
}));
vi.mock("../src/tools/flash-verification.js", () => ({
  executeFlashVerification: mocks.execute,
}));
vi.mock("../src/adapters/decode-compat.js", () => ({
  executeDecodeCompatibility: mocks.decode,
}));
import {
  executeFlashVerificationCompatibility,
  FlashVerificationCompatibilitySchema,
} from "../src/adapters/flash-verification-compat.js";
const client = {} as SerialClientContext;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({
    environment: "esp",
    request: { path: "monitor", baudRate: 74880 },
  });
  mocks.execute.mockResolvedValue({
    ok: true,
    verdict: "pass",
    lines: ["ready"],
    firmware_identity: "identity_unverified",
  });
  mocks.decode.mockResolvedValue({
    ok: true,
    frames: [],
    flashed_firmware_verified: false,
  });
});
it("maps reference defaults and distinct ports without weakening the legacy quiet window", async () => {
  const result = await executeFlashVerificationCompatibility(
    {
      upload_port: "upload",
      monitor_port: "monitor",
      approval_id: "upload-grant",
      monitor_approval_id: "open-grant",
    },
    client,
  );
  expect(mocks.resolve.mock.calls[0][0]).toMatchObject({ port: "monitor" });
  expect(mocks.execute.mock.calls[0][0]).toMatchObject({
    environment: "esp",
    uploadPort: "upload",
    monitorPort: "monitor",
    baudRate: 74880,
    uploadApprovalId: "upload-grant",
    openApprovalId: "open-grant",
    verification: {
      timeoutSeconds: 30,
      maxLines: 500,
      settleSeconds: 2.25,
      stabilityWindowSeconds: 10,
    },
  });
  expect(result).toMatchObject({
    ok: true,
    firmware_identity: "identity_unverified",
  });
  expect(mocks.decode).not.toHaveBeenCalled();
});
it("decodes failed boot evidence using separate analysis grants", async () => {
  mocks.execute.mockResolvedValueOnce({
    ok: false,
    verdict: "fail",
    lines: ["HardFault", "pc 0x40001234"],
  });
  expect(
    await executeFlashVerificationCompatibility(
      { decode_approval_id: "decode", decode_config_approval_id: "config" },
      client,
    ),
  ).toMatchObject({
    ok: false,
    verdict: "fail",
    decoded: { ok: true, flashed_firmware_verified: false },
  });
  expect(mocks.decode.mock.calls[0][1]).toMatchObject({
    env: "esp",
    text: "HardFault\npc 0x40001234",
    approval_id: "decode",
    config_approval_id: "config",
  });
});
it("retains boot failure when decoding is unavailable", async () => {
  mocks.execute.mockResolvedValueOnce({
    ok: false,
    verdict: "fail",
    lines: ["HardFault"],
  });
  mocks.decode.mockRejectedValueOnce(new Error("unavailable"));
  expect(await executeFlashVerificationCompatibility({}, client)).toMatchObject(
    {
      ok: false,
      verdict: "fail",
      decoded: { ok: false, error: "CRASH_DECODE_UNAVAILABLE" },
    },
  );
});
it("requires a concrete environment before upload", async () => {
  mocks.resolve.mockResolvedValueOnce({
    request: { path: "monitor", baudRate: 115200 },
  });
  await expect(
    executeFlashVerificationCompatibility({}, client),
  ).rejects.toMatchObject({ code: "PROJECT_ENVIRONMENT_INVALID" });
  expect(mocks.execute).not.toHaveBeenCalled();
});
it("rejects malformed public arguments before resolving configuration", async () => {
  await expect(
    executeFlashVerificationCompatibility(
      { stop_open_sessions: "yes" },
      client,
    ),
  ).rejects.toMatchObject({ code: "COMPAT_ARGUMENT_INVALID" });
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it("retains the pinned default fault signatures", () => {
  const pattern = new RegExp(
    FlashVerificationCompatibilitySchema.parse({}).fail_on,
  );
  for (const line of [
    "abort() was called",
    "rst:0x1 (TG1WDT_SYS_RESET",
    "panic'ed",
    "HardFault",
  ])
    expect(pattern.test(line)).toBe(true);
});
