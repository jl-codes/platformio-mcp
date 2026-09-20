/** Compatibility capture defaults and missing-ELF behavior preserve scoped grants and failures. */
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../src/adapters/compatibility-project.js", () => ({
  resolveCompatibilityProject: vi.fn(async () => "project"),
}));
vi.mock("../src/tools/run-target.js", () => ({
  resolveTargetSerialSelection: vi.fn(async () => ({
    environment: "esp",
    port: "port",
  })),
}));
vi.mock("../src/core/policy/revision-guard.js", () => ({
  createPolicyRevisionGuard: () => () => {},
}));
vi.mock("../src/core/analysis/collect-build-context.js", () => ({
  collectBuildMetadata: vi.fn(),
}));
vi.mock("../src/tools/coredump.js", () => ({ executeCoredump: vi.fn() }));
vi.mock("node:fs/promises", () => ({ default: { access: vi.fn() } }));
import fs from "node:fs/promises";
import { collectBuildMetadata } from "../src/core/analysis/collect-build-context.js";
import { executeCoredump } from "../src/tools/coredump.js";
import { resolveTargetSerialSelection } from "../src/tools/run-target.js";
import { executeCoredumpCompatibility } from "../src/adapters/coredump-compat.js";
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(executeCoredump).mockResolvedValue({
    ok: false,
    analyzed: false,
    error: "no_coredump",
    acquisition: {
      port: "port",
      partition: "crash",
      offset: 4096,
      length: 4096,
      logPath: "log",
      sha256: "hash",
    },
    layout: {
      environment: "esp",
      table: { path: "partitions.csv", size: 1, sha256: "hash" },
      table_source: "explicit",
      table_offset: 0x8000,
      evidence: "offline_layout",
    },
    dump_export: {
      path: "private/crash.bin",
      size: 4096,
      sha256: "hash",
      retention: "user_managed",
    },
  });
});
it("defaults to managed saving and maps empty captures without claiming analysis", async () => {
  const result = await executeCoredumpCompatibility({
    analyze: false,
    port: "explicit",
    export_approval_id: "save",
  });
  expect(resolveTargetSerialSelection).toHaveBeenCalledWith(
    "project",
    undefined,
    expect.anything(),
    expect.anything(),
    "explicit",
  );
  expect(executeCoredump).toHaveBeenCalledWith(
    expect.objectContaining({
      analyze: false,
      retainDump: true,
      exportApprovalId: "save",
    }),
    {},
    undefined,
  );
  expect(collectBuildMetadata).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    ok: false,
    error: "coredump_empty",
    analysis: null,
    dump_bytes: 4096,
    partition: { name: "crash", size: 4096 },
  });
});
it("saves when selected metadata points to an ELF that has not been built", async () => {
  vi.mocked(collectBuildMetadata).mockResolvedValue({
    environment: "esp",
    compilerPath: "compiler",
    elfPath: "missing.elf",
  });
  vi.mocked(fs.access).mockRejectedValueOnce(
    Object.assign(new Error("missing"), { code: "ENOENT" }),
  );
  await executeCoredumpCompatibility({
    elf_metadata_approval_id: "metadata",
    out_path: "crash.bin",
  });
  expect(collectBuildMetadata).toHaveBeenCalledWith(
    { projectDir: "project", environment: "esp", approvalId: "metadata" },
    {},
  );
  expect(executeCoredump).toHaveBeenCalledWith(
    expect.objectContaining({
      analyze: false,
      retainDump: false,
      outPath: "crash.bin",
    }),
    {},
    undefined,
  );
});
it("never turns metadata permission failures into capture authorization", async () => {
  vi.mocked(collectBuildMetadata).mockRejectedValueOnce(
    Object.assign(new Error("denied"), { code: "POLICY_DENIED" }),
  );
  await expect(executeCoredumpCompatibility({})).rejects.toMatchObject({
    code: "POLICY_DENIED",
  });
  expect(executeCoredump).not.toHaveBeenCalled();
});
