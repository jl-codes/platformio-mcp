import { approveRequest, getApproval } from "../src/core/policy/approvals.js";
/** Handler integration with real policy/package/ELF validation and mocked external processes. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { decodeBacktrace, firmwareSizeReport } from "../src/tools/analysis.js";
import { platformioExecutor } from "../src/platformio.js";
import { runAnalysisProcess } from "../src/core/analysis/analysis-process.js";
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: { execute: vi.fn(), executeWithJsonOutput: vi.fn() },
}));
vi.mock("../src/core/analysis/analysis-process.js", () => ({
  runAnalysisProcess: vi.fn(),
}));
let root: string, project: string, core: string, elfPath: string;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PIO_MCP_TOOLCHAIN_ROOTS", undefined);
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-analysis-handler-"));
  project = path.join(root, "project");
  core = path.join(root, "core");
  fs.mkdirSync(project);
  const pkg = path.join(core, "packages/toolchain-arm");
  const bin = path.join(pkg, "bin");
  fs.mkdirSync(bin, { recursive: true });
  for (const tool of ["gcc", "nm", "size", "addr2line"])
    fs.writeFileSync(path.join(bin, `arm-none-eabi-${tool}.exe`), "fixture");
  fs.writeFileSync(
    path.join(pkg, "package.json"),
    '{"name":"toolchain-arm","version":"1"}',
  );
  fs.writeFileSync(
    path.join(pkg, ".piopm"),
    '{"type":"tool","name":"toolchain-arm","version":"1"}',
  );
  const elf = Buffer.alloc(128);
  elf.write("7f454c46", 0, "hex");
  elf[4] = 1;
  elf[5] = 1;
  elf[6] = 1;
  elf.writeUInt16LE(2, 16);
  elf.writeUInt16LE(40, 18);
  elf.writeUInt32LE(1, 20);
  elf.writeUInt16LE(52, 40);
  elfPath = path.join(project, "firmware.elf");
  fs.writeFileSync(elfPath, elf);
  vi.mocked(platformioExecutor.executeWithJsonOutput).mockResolvedValue({
    core_dir: { value: core },
  });
  vi.mocked(platformioExecutor.execute).mockImplementation(async (command) => ({
    exitCode: 0,
    stderr: "",
    stdout:
      command === "project"
        ? JSON.stringify({
            fixture: {
              cc_path: path.join(bin, "arm-none-eabi-gcc.exe"),
              prog_path: elfPath,
            },
          })
        : "RAM: 10.0% (used 10 bytes from 100 bytes)\nFlash: 20.0% (used 20 bytes from 100 bytes)",
  }));
  vi.mocked(runAnalysisProcess).mockImplementation(async (tool, args) => ({
    stderr: "",
    stdout: tool.endsWith("addr2line.exe")
      ? "0x08001234: known() at /fixture/main.cpp:4"
      : tool.endsWith("nm.exe")
        ? "08001234 00000010 T known()\t/fixture/main.cpp:4"
        : args[0] === "-A"
          ? ".text 16 134217728"
          : "16 0 0 16 10 firmware.elf",
  }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
it("joins authorized metadata, package discovery and crash decoding", async () => {
  const result = await decodeBacktrace({
    projectDir: project,
    environment: "fixture",
    text: "PC: 0x08001234",
  });
  expect(result).toMatchObject({
    ok: true,
    flashedFirmwareVerified: false,
    frames: [{ function: "known()", line: 4, resolved: true }],
  });
});
it("reports bound PlatformIO memory separately from GNU estimates", async () => {
  expect(
    await firmwareSizeReport({
      projectDir: project,
      environment: "fixture",
      filter: "known",
    }),
  ).toMatchObject({
    ok: true,
    memorySource: "platformio",
    memory: { flash: { usedBytes: 20 } },
    totals: { flashEstimate: 16 },
    symbolCount: 1,
  });
});
it("rejects tool-supplied trust roots before any process", async () => {
  await expect(
    decodeBacktrace({
      projectDir: project,
      environment: "fixture",
      text: "PC: 0x08001234",
      trustedToolchainRoots: [root],
    }),
  ).rejects.toThrow();
  expect(platformioExecutor.execute).not.toHaveBeenCalled();
  expect(runAnalysisProcess).not.toHaveBeenCalled();
});
it("denies project script execution under read-only policy", async () => {
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    '{"profile":"read_only"}',
  );
  await expect(
    firmwareSizeReport({ projectDir: project, environment: "fixture" }),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(platformioExecutor.execute).not.toHaveBeenCalled();
  expect(platformioExecutor.executeWithJsonOutput).not.toHaveBeenCalled();
});
it("rejects a requested artifact mismatch before analysis utilities", async () => {
  await expect(
    firmwareSizeReport({
      projectDir: project,
      environment: "fixture",
      expectedElfSha256: "0".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "ANALYSIS_ELF_MISMATCH" });
  expect(runAnalysisProcess).not.toHaveBeenCalled();
});

it("stops between metadata and later stages when project policy changes", async () => {
  const execute = vi
    .mocked(platformioExecutor.execute)
    .getMockImplementation()!;
  vi.mocked(platformioExecutor.execute).mockImplementation(async (...args) => {
    const result = await execute(...args);
    fs.writeFileSync(
      path.join(project, ".pio-mcp-policy.json"),
      '{"profile":"read_only"}',
    );
    return result;
  });
  await expect(
    firmwareSizeReport({ projectDir: project, environment: "fixture" }),
  ).rejects.toMatchObject({ code: "POLICY_CHANGED" });
  expect(platformioExecutor.executeWithJsonOutput).not.toHaveBeenCalled();
  expect(runAnalysisProcess).not.toHaveBeenCalled();
});
it("does not return decoded output after policy changes during a utility call", async () => {
  const execute = vi.mocked(runAnalysisProcess).getMockImplementation()!;
  vi.mocked(runAnalysisProcess).mockImplementation(async (...args) => {
    const result = await execute(...args);
    fs.writeFileSync(
      path.join(project, ".pio-mcp-policy.json"),
      '{"profile":"read_only"}',
    );
    return result;
  });
  await expect(
    decodeBacktrace({
      projectDir: project,
      environment: "fixture",
      text: "PC: 0x08001234",
    }),
  ).rejects.toMatchObject({ code: "POLICY_CHANGED" });
});

it("consumes one request-bound grant for metadata and size stages, rejecting changed input and replay", async () => {
  const policy = path.join(root, "operator.json");
  fs.writeFileSync(policy, '{"approval_required":["build_project"]}');
  vi.stubEnv("PIO_MCP_POLICY_FILE", policy);
  const input = {
    projectDir: project,
    environment: "fixture",
    filter: "known",
  };
  const pending = await firmwareSizeReport(input).catch((error) => error);
  expect(pending.code).toBe("APPROVAL_REQUIRED");
  const id = pending.context.policyDecision.approvalId;
  approveRequest(id);
  await expect(
    firmwareSizeReport({ ...input, filter: "other", approvalId: id }),
  ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  expect(platformioExecutor.execute).not.toHaveBeenCalled();
  expect(await firmwareSizeReport({ ...input, approvalId: id })).toMatchObject({
    ok: true,
    memorySource: "platformio",
  });
  expect(platformioExecutor.execute).toHaveBeenCalledTimes(2);
  expect(getApproval(id)?.status).toBe("consumed");
  await expect(
    firmwareSizeReport({ ...input, approvalId: id }),
  ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  expect(platformioExecutor.execute).toHaveBeenCalledTimes(2);
});
