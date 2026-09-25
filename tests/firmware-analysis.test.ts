/** Report-engine fixtures verify orchestration; real toolchain/hardware acceptance remains separate. */
import { readElfIdentity } from "../src/core/analysis/elf-identity.js";
import fs from "node:fs";
import * as elfArchive from "../src/core/analysis/elf-archive.js";
const retainElf = elfArchive.retainElfSnapshot;
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeFirmwareCrash,
  reportFirmwareSize,
  type FirmwareAnalysisContext,
} from "../src/core/analysis/firmware-analysis.js";
import { runAnalysisProcess } from "../src/core/analysis/analysis-process.js";
vi.mock("../src/core/analysis/analysis-process.js", () => ({
  runAnalysisProcess: vi.fn(),
}));
let root: string;
let context: FirmwareAnalysisContext;
let snapshots: string[];
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-analysis-report-"));
  snapshots = [];
  vi.spyOn(elfArchive, "retainElfSnapshot").mockImplementation((file, hash) =>
    retainElf(file, hash, path.join(root, "archive")),
  );
  const bin = path.join(root, "toolchain", "bin");
  fs.mkdirSync(bin, { recursive: true });
  for (const name of ["gcc", "addr2line", "size", "nm"])
    fs.writeFileSync(path.join(bin, `arm-none-eabi-${name}.exe`), "fixture");
  const elf = Buffer.alloc(128);
  elf.write("7f454c46", 0, "hex");
  elf[4] = 1;
  elf[5] = 1;
  elf[6] = 1;
  elf.writeUInt16LE(2, 16);
  elf.writeUInt16LE(40, 18);
  elf.writeUInt32LE(1, 20);
  elf.writeUInt16LE(52, 40);
  fs.writeFileSync(path.join(root, "firmware.elf"), elf);
  context = {
    projectDir: root,
    environment: "fixture",
    elfPath: path.join(root, "firmware.elf"),
    compilerPath: path.join(bin, "arm-none-eabi-gcc.exe"),
    trustedToolchainRoots: [path.join(root, "toolchain")],
  };
  vi.mocked(runAnalysisProcess).mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const snapshot of snapshots) expect(fs.existsSync(snapshot)).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});
describe("firmware report engines", () => {
  it("combines resolved and unresolved frames without claiming flashed identity", async () => {
    vi.mocked(runAnalysisProcess).mockImplementation(async (_tool, args) => {
      const snapshot = args[2];
      snapshots.push(snapshot);
      expect(fs.existsSync(snapshot)).toBe(true);
      return {
        stdout:
          "0x08001234: crash() at /fixture/main.cpp:9\n0x08005678: ?? ??:0\n",
        stderr: "",
      };
    });
    const report = await decodeFirmwareCrash(
      context,
      "PC: 0x08001234 LR: 0x08005678",
    );
    expect(report).toMatchObject({
      ok: true,
      artifactIdentity: "current_elf_only",
      flashedFirmwareVerified: false,
    });
    expect(report.frames.map((frame) => frame.resolved)).toEqual([true, false]);
  });
  it("returns no-address evidence without invoking tools", async () => {
    expect(
      await decodeFirmwareCrash(context, "ordinary boot output"),
    ).toMatchObject({ ok: false, error: "no_addresses" });
    expect(runAnalysisProcess).not.toHaveBeenCalled();
  });
  it("uses the same verified snapshot even if a rebuild changes the original", async () => {
    const original = fs.readFileSync(context.elfPath);
    vi.mocked(runAnalysisProcess).mockImplementation(async (tool, args) => {
      const snapshot = args[args.length - 1];
      snapshots.push(snapshot);
      expect(fs.readFileSync(snapshot)).toEqual(original);
      fs.writeFileSync(context.elfPath, "changed during analysis");
      return {
        stdout: tool.endsWith("nm.exe")
          ? "08000100 00000010 T main\t/fixture/main.cpp:2"
          : args[0] === "-A"
            ? ".text 16 134217728"
            : "16 0 0 16 10 firmware.elf",
        stderr: "",
      };
    });
    const report = await reportFirmwareSize(context, 1);
    expect(report).toMatchObject({
      ok: true,
      memorySource: "estimate_from_size",
      totals: { flashEstimate: 16, ramEstimate: 0 },
      symbolCount: 1,
    });
    expect(new Set(snapshots).size).toBe(1);
  });
  it("filters names or paths before ranking without changing whole-image totals", async () => {
    vi.mocked(runAnalysisProcess).mockImplementation(async (tool, args) => ({
      stdout: tool.endsWith("nm.exe")
        ? "08000100 00000010 T selected\t/fixture/other.cpp:2\n08000200 00000020 T another\t/fixture/selected.cpp:3\n08000300 00000030 T unrelated\n"
        : args[0] === "-A"
          ? ".text 96 134217728"
          : "96 0 0 96 60 firmware.elf",
      stderr: "",
    }));
    const report = await reportFirmwareSize(
      context,
      1,
      "^SELECTED$|selected[.]cpp$",
    );
    expect(report.symbolCount).toBe(2);
    expect(report.topSymbols.map((symbol) => symbol.name)).toEqual(["another"]);
    expect(report.totals.flashEstimate).toBe(96);
    expect(report.filter).toBe("^SELECTED$|selected[.]cpp$");
    await expect(reportFirmwareSize(context, 1, "[")).rejects.toMatchObject({
      code: "PATTERN_INVALID",
    });
  });
  it("uses only successful memory accounting bound to the same environment and ELF", async () => {
    vi.mocked(runAnalysisProcess).mockImplementation(async (tool, args) => ({
      stdout: tool.endsWith("nm.exe")
        ? ""
        : args[0] === "-A"
          ? ".text 16 134217728"
          : "16 0 0 16 10 firmware.elf",
      stderr: "",
    }));
    const identity = await readElfIdentity(context.elfPath);
    context.memoryEvidence = {
      environment: context.environment,
      elfSha256: identity.sha256,
      exitCode: 0,
      output:
        "RAM: 10.0% (used 10 bytes from 100 bytes)\nFlash: 20.0% (used 20 bytes from 100 bytes)",
    };
    expect(await reportFirmwareSize(context)).toMatchObject({
      memorySource: "platformio",
      memory: { flash: { usedBytes: 20 } },
      totals: { flashEstimate: 16 },
    });
    context.memoryEvidence.exitCode = 1;
    expect(await reportFirmwareSize(context)).toMatchObject({
      memorySource: "estimate_from_size",
      memory: null,
      memoryUnavailableReason: "size_check_failed",
    });
    context.memoryEvidence.elfSha256 = "0".repeat(64);
    await expect(reportFirmwareSize(context)).rejects.toMatchObject({
      code: "ANALYSIS_MEMORY_MISMATCH",
    });
  });
  it("removes snapshots after tool failure", async () => {
    vi.mocked(runAnalysisProcess).mockImplementation(async (_tool, args) => {
      snapshots.push(args[2]);
      throw new Error("tool failed");
    });
    await expect(
      decodeFirmwareCrash(context, "PC: 0x08001234"),
    ).rejects.toThrow("tool failed");
  });
  it("rejects an artifact mismatch before any utility executes", async () => {
    await expect(
      reportFirmwareSize({ ...context, expectedElfSha256: "a".repeat(64) }),
    ).rejects.toMatchObject({ code: "ANALYSIS_ELF_MISMATCH" });
    expect(runAnalysisProcess).not.toHaveBeenCalled();
  });
});
