/** Compile-only regression coverage at the shared execution boundary. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTests } from "../src/tools/build.js";
import { executeWithSpooling } from "../src/utils/spooler.js";

vi.mock("../src/utils/spooler.js", () => ({ executeWithSpooling: vi.fn() }));
let project: string;
beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "pio-test-mode-"));
  fs.writeFileSync(
    path.join(project, "platformio.ini"),
    "[env:fixture]\nplatform=native\n",
  );
  vi.mocked(executeWithSpooling).mockReset();
  vi.mocked(executeWithSpooling).mockResolvedValue({
    exitCode: 0,
    finalOutput: "ok",
  } as never);
});
afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

describe("test execution mode", () => {
  it.each([undefined, false, true])(
    "build_only forces both disabled stages even when compileOnly is %s",
    async (compileOnly) => {
      fs.writeFileSync(
        path.join(project, ".pio-mcp-policy.json"),
        JSON.stringify({ profile: "build_only" }),
      );
      await runTests(project, "fixture", true, compileOnly);
      expect(executeWithSpooling).toHaveBeenCalledWith(
        "test",
        [
          "--without-uploading",
          "--without-testing",
          "--environment",
          "fixture",
        ],
        expect.objectContaining({ background: true }),
      );
    },
  );
  it("explicit compile-only disables both stages under the default policy", async () => {
    await runTests(project, "fixture", false, true);
    expect(executeWithSpooling).toHaveBeenCalledWith(
      "test",
      ["--without-uploading", "--without-testing", "--environment", "fixture"],
      expect.anything(),
    );
  });
  it("preserves existing full-test behavior outside build_only", async () => {
    await runTests(project, "fixture", false);
    expect(executeWithSpooling).toHaveBeenCalledWith(
      "test",
      ["--environment", "fixture"],
      expect.anything(),
    );
  });
  it("rejects malformed compileOnly before process execution", async () => {
    await expect(
      runTests(project, "fixture", false, "false" as never),
    ).rejects.toThrow("compileOnly must be a boolean");
    expect(executeWithSpooling).not.toHaveBeenCalled();
  });
  it("fails closed for invalid policy before process execution", async () => {
    fs.writeFileSync(path.join(project, ".pio-mcp-policy.json"), "invalid");
    await expect(runTests(project, "fixture", false)).rejects.toThrow();
    expect(executeWithSpooling).not.toHaveBeenCalled();
  });
});


it("reference test filters preserve compile-only restrictions and literal argv", async () => {
  fs.writeFileSync(path.join(project, ".pio-mcp-policy.json"), JSON.stringify({ profile: "build_only" }));
  await runTests(project, "fixture", false, false, { filter: "test_math*", ignore: "test_slow*", withoutUploading: false, uploadPort: "COM99", verbose: true, timeoutMs: 1200000 });
  expect(executeWithSpooling).toHaveBeenCalledWith("test", ["--without-uploading", "--without-testing", "--filter", "test_math*", "--ignore", "test_slow*", "--verbose", "--environment", "fixture"], expect.objectContaining({ timeout: 1200000 }));
});

it("without-uploading alone does not silently imply compile-only outside build-only", async () => {
  await runTests(project, "fixture", false, false, { withoutUploading: true, withoutBuilding: true });
  expect(executeWithSpooling).toHaveBeenCalledWith("test", ["--without-uploading", "--without-building", "--environment", "fixture"], expect.anything());
});

it("contradictory build-only and skip-building fails before execution", async () => {
  await expect(runTests(project, "fixture", false, true, { withoutBuilding: true })).rejects.toThrow("Cannot skip building");
  expect(executeWithSpooling).not.toHaveBeenCalled();
});
