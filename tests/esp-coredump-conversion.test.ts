/** Conversion orchestration exercises real private storage with a controlled process substitute. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
vi.mock("../src/core/analysis/analysis-process.js", () => ({
  runAnalysisProcess: vi.fn(),
}));
import { runAnalysisProcess } from "../src/core/analysis/analysis-process.js";
import { withConvertedEspCoredump } from "../src/core/analysis/esp-coredump-conversion.js";
import type { EspCoredumpAnalysisArtifacts } from "../src/core/analysis/esp-coredump-analysis.js";
const bytes = Buffer.from("fixture");
const artifacts = {
  dump: {
    bytes,
    identity: { sha256: createHash("sha256").update(bytes).digest("hex") },
  },
  elfPath: path.resolve("firmware.elf"),
  elfIdentity: { machine: 94 },
} as EspCoredumpAnalysisArtifacts;
it("validates converted output and deletes raw/core files when the consumer fails", async () => {
  let directory = "";
  vi.mocked(runAnalysisProcess).mockImplementationOnce(
    async (_python, args, options) => {
      expect(args.slice(0, 2)).toEqual(["-I", "-c"]);
      directory = options!.cwd!;
      expect(await fs.readFile(path.join(directory, "dump.raw"))).toEqual(
        bytes,
      );
      const core = Buffer.alloc(52);
      Buffer.from("7f454c46010101", "hex").copy(core);
      core.writeUInt16LE(4, 16);
      core.writeUInt16LE(94, 18);
      const output = path.join(directory, "converted.elf");
      await fs.writeFile(output, core);
      return {
        stdout: JSON.stringify({
          core_path: output,
          converter_version: "1.10.0",
        }),
        stderr: "",
      };
    },
  );
  await expect(
    withConvertedEspCoredump(
      artifacts,
      { pythonExecutable: process.execPath, validatePolicy: () => {} },
      async (core, hash) => {
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
        expect(await fs.stat(core)).toBeDefined();
        throw new Error("consumer failed");
      },
    ),
  ).rejects.toThrow("consumer failed");
  await expect(fs.stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
}, 20000);
it("preserves a missing optional dependency error without calling the consumer", async () => {
  vi.mocked(runAnalysisProcess).mockResolvedValueOnce({
    stdout: '{"error":"COREDUMP_TOOL_UNAVAILABLE"}',
    stderr: "",
    exitCode: 2,
  });
  const use = vi.fn();
  await expect(
    withConvertedEspCoredump(
      artifacts,
      { pythonExecutable: process.execPath, validatePolicy: () => {} },
      use,
    ),
  ).rejects.toMatchObject({ code: "COREDUMP_TOOL_UNAVAILABLE" });
  expect(use).not.toHaveBeenCalled();
}, 20000);
