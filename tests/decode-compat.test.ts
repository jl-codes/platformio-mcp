/** Adapter permission failures must stop before build execution or serial-text delivery. */
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ config: vi.fn(), decode: vi.fn() }));
vi.mock("../src/adapters/compatibility-project.js", () => ({
  resolveCompatibilityProject: async () => "/project",
}));
vi.mock("../src/core/policy/revision-guard.js", () => ({
  createPolicyRevisionGuard: () => () => {},
}));
vi.mock("../src/tools/project-inspection.js", () => ({
  executeProjectInspection: mocks.config,
}));
vi.mock("../src/tools/analysis.js", () => ({ decodeBacktrace: mocks.decode }));
import { executeDecodeCompatibility } from "../src/adapters/decode-compat.js";
import { SerialClientContext } from "../src/adapters/serial-client.js";
beforeEach(() => {
  vi.resetAllMocks();
});
it("does not run analysis after a configuration permission rejection", async () => {
  mocks.config.mockRejectedValue(new Error("denied"));
  await expect(
    executeDecodeCompatibility(
      {} as SerialClientContext,
      { text: "Backtrace: 0x40001234:0x3ffb0000" },
      {},
      {},
    ),
  ).rejects.toThrow("denied");
  expect(mocks.decode).not.toHaveBeenCalled();
});
it("does not inspect project or decode after an owned-session read rejection", async () => {
  const read = vi.fn().mockRejectedValue(new Error("session denied"));
  const run = vi.fn(async (_context, callback) =>
    callback({ sessions: { read } }, { id: "trusted-owner" }),
  );
  await expect(
    executeDecodeCompatibility(
      { run } as unknown as SerialClientContext,
      {
        session_id: "someone-elses-session",
        text: "Backtrace: 0x40001234:0x3ffb0000",
      },
      {},
      {},
    ),
  ).rejects.toThrow("session denied");
  expect(mocks.config).not.toHaveBeenCalled();
  expect(mocks.decode).not.toHaveBeenCalled();
});
it("passes separate config and analysis grants and retains ELF identity", async () => {
  mocks.config.mockResolvedValue({
    ok: true,
    defaultEnvironments: ["esp"],
    envs: [{ name: "esp" }],
  });
  mocks.decode.mockResolvedValue({
    ok: true,
    frames: [{ resolved: true }],
    causes: [],
    resetReasons: [],
    backtraceCorrupted: false,
    elf: {
      path: "/project/fw.elf",
      sha256: "a".repeat(64),
      archivePath: "/retained/fw.elf",
    },
    environment: "esp",
    addr2line: "/trusted/addr2line",
    flashedFirmwareVerified: false,
  });
  const result = await executeDecodeCompatibility(
    {} as SerialClientContext,
    {
      text: "Backtrace: 0x40001234:0x3ffb0000",
      config_approval_id: "configuration",
      approval_id: "analysis",
      archived_elf_sha256: "a".repeat(64),
    },
    {},
    {},
  );
  expect(mocks.config.mock.calls[0][1].approvalId).toBe("configuration");
  expect(mocks.decode.mock.calls[0][0]).toMatchObject({
    approvalId: "analysis",
    archivedElfSha256: "a".repeat(64),
    environment: "esp",
  });
  expect(result).toMatchObject({
    elf_sha256: "a".repeat(64),
    elf_archive_path: "/retained/fw.elf",
    flashed_firmware_verified: false,
  });
});

it("rejects malformed archive identities before project inspection or session access", async () => {
  const run = vi.fn();
  await expect(
    executeDecodeCompatibility(
      { run } as unknown as SerialClientContext,
      { session_id: "owned", archived_elf_sha256: "../other-project" },
      {},
      {},
    ),
  ).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
  expect(mocks.config).not.toHaveBeenCalled();
  expect(mocks.decode).not.toHaveBeenCalled();
});
