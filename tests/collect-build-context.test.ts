import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { platformioExecutor } from "../src/platformio.js";
import {
  collectBuildMetadata,
  collectProgramMemory,
} from "../src/core/analysis/collect-build-context.js";
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: { execute: vi.fn() },
}));
let project: string;
beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "pio-metadata-"));
  vi.mocked(platformioExecutor.execute).mockReset();
});
afterEach(() => fs.rmSync(project, { recursive: true, force: true }));
it("denies metadata script execution under read_only before invoking PlatformIO", async () => {
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    '{"profile":"read_only"}',
  );
  await expect(
    collectBuildMetadata({ projectDir: project, environment: "fixture" }),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(platformioExecutor.execute).not.toHaveBeenCalled();
});
it("collects only the selected environment with a finite timeout", async () => {
  vi.mocked(platformioExecutor.execute).mockResolvedValue({
    exitCode: 0,
    stdout: JSON.stringify({
      fixture: {
        cc_path: path.join(project, "gcc"),
        prog_path: path.join(project, "firmware.elf"),
      },
    }),
    stderr: "",
  });
  expect(
    (
      await collectBuildMetadata({
        projectDir: project,
        environment: "fixture",
      })
    ).environment,
  ).toBe("fixture");
  expect(platformioExecutor.execute).toHaveBeenCalledWith(
    "project",
    ["metadata", "--json-output", "--environment", "fixture"],
    { cwd: project, timeout: 600000 },
  );
});
it("rejects failed metadata rather than parsing possibly stale stdout", async () => {
  vi.mocked(platformioExecutor.execute).mockResolvedValue({
    exitCode: 1,
    stdout: "{}",
    stderr: "failure",
  });
  await expect(
    collectBuildMetadata({ projectDir: project, environment: "fixture" }),
  ).rejects.toMatchObject({ code: "ANALYSIS_METADATA_FAILED" });
});
it("rejects missing or flag-like environment before executing", async () => {
  for (const environment of ["", "--target=upload", "--verbose"]) {
    await expect(
      collectBuildMetadata({ projectDir: project, environment }),
    ).rejects.toThrow();
  }
  expect(platformioExecutor.execute).not.toHaveBeenCalled();
});

function writeElf() {
  const elf = Buffer.alloc(128);
  elf.write("7f454c46", 0, "hex");
  elf[4] = 1;
  elf[5] = 1;
  elf[6] = 1;
  elf.writeUInt16LE(2, 16);
  elf.writeUInt16LE(40, 18);
  elf.writeUInt32LE(1, 20);
  elf.writeUInt16LE(52, 40);
  const file = path.join(project, "firmware.elf");
  fs.writeFileSync(file, elf);
  return file;
}
it("binds successful memory collection to an unchanged ELF", async () => {
  const elf = writeElf();
  vi.mocked(platformioExecutor.execute).mockResolvedValue({
    exitCode: 0,
    stdout: "memory output",
    stderr: "",
  });
  const evidence = await collectProgramMemory(
    { projectDir: project, environment: "fixture" },
    elf,
  );
  expect(evidence).toMatchObject({
    environment: "fixture",
    exitCode: 0,
    output: "memory output",
  });
  expect(evidence.elfSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(platformioExecutor.execute).toHaveBeenCalledWith(
    "run",
    ["--environment", "fixture", "--target", "checkprogsize"],
    expect.objectContaining({ cwd: project }),
  );
});
it("rejects evidence if the size check changes the analyzed artifact", async () => {
  const elf = writeElf();
  vi.mocked(platformioExecutor.execute).mockImplementation(async () => {
    const bytes = fs.readFileSync(elf);
    bytes[80] = 1;
    fs.writeFileSync(elf, bytes);
    return { exitCode: 0, stdout: "memory output", stderr: "" };
  });
  await expect(
    collectProgramMemory({ projectDir: project, environment: "fixture" }, elf),
  ).rejects.toMatchObject({ code: "ANALYSIS_ELF_MISMATCH" });
});
it("authorizes before reading the artifact or running size-check scripts", async () => {
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    '{"profile":"read_only"}',
  );
  await expect(
    collectProgramMemory(
      { projectDir: project, environment: "fixture" },
      path.join(project, "missing.elf"),
    ),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(platformioExecutor.execute).not.toHaveBeenCalled();
});
