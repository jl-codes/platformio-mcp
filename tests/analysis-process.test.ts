/** Real subprocess tests use Node fixtures, never PlatformIO or hardware execution. */
import { describe, expect, it } from "vitest";
import { runAnalysisProcess } from "../src/core/analysis/analysis-process.js";

describe("analysis subprocess bounds", () => {
  it("passes arguments literally and captures complete UTF-8 output", async () => {
    const text = "$(not-a-command); & 測試";
    const result = await runAnalysisProcess(process.execPath, [
      "-e",
      "process.stdout.write(process.argv[1]); process.stderr.write('diagnostic')",
      text,
    ]);
    expect(result).toEqual({ stdout: text, stderr: "diagnostic" });
  });
  it("rejects failure instead of accepting partial output", async () => {
    await expect(
      runAnalysisProcess(process.execPath, [
        "-e",
        "process.stdout.write('partial'); process.exit(3)",
      ]),
    ).rejects.toMatchObject({
      code: "ANALYSIS_TOOL_FAILED",
      context: { exitCode: 3 },
    });
  });
  it("terminates an overlong utility", async () => {
    await expect(
      runAnalysisProcess(
        process.execPath,
        ["-e", "setInterval(()=>{}, 1000)"],
        { timeoutMs: 100 },
      ),
    ).rejects.toMatchObject({ code: "ANALYSIS_TIMEOUT" });
  });
  it("rejects excessive output rather than parsing a truncated report", async () => {
    await expect(
      runAnalysisProcess(
        process.execPath,
        ["-e", "process.stdout.write('x'.repeat(10000))"],
        { maxOutputBytes: 100 },
      ),
    ).rejects.toMatchObject({ code: "ANALYSIS_OUTPUT_LIMIT" });
  });
  it("supports cancellation before launch and while running", async () => {
    const before = new AbortController();
    before.abort();
    await expect(
      runAnalysisProcess(process.execPath, [], { signal: before.signal }),
    ).rejects.toMatchObject({ code: "ANALYSIS_CANCELLED" });
    const during = new AbortController();
    const running = runAnalysisProcess(
      process.execPath,
      ["-e", "setInterval(()=>{}, 1000)"],
      { signal: during.signal },
    );
    setTimeout(() => during.abort(), 100);
    await expect(running).rejects.toMatchObject({ code: "ANALYSIS_CANCELLED" });
  });
  it("rejects shell shims, relative executables and invalid limits", async () => {
    await expect(runAnalysisProcess("node", [])).rejects.toMatchObject({
      code: "ANALYSIS_EXECUTABLE_INVALID",
    });
    await expect(
      runAnalysisProcess(process.execPath + ".cmd", []),
    ).rejects.toMatchObject({ code: "ANALYSIS_EXECUTABLE_INVALID" });
    await expect(
      runAnalysisProcess(process.execPath, [], { timeoutMs: Infinity }),
    ).rejects.toMatchObject({ code: "ANALYSIS_LIMIT_INVALID" });
  });
});
it("accepts only explicitly selected protocol exit codes", async () => {
  const result = await runAnalysisProcess(
    process.execPath,
    ["-e", "process.stdout.write('{}'); process.exit(2)"],
    { allowedExitCodes: [2] },
  );
  expect(result).toEqual({ stdout: "{}", stderr: "", exitCode: 2 });
  await expect(
    runAnalysisProcess(process.execPath, ["-e", "process.exit(3)"], {
      allowedExitCodes: [2],
    }),
  ).rejects.toMatchObject({ code: "ANALYSIS_TOOL_FAILED" });
});
