/** Verify clean target selection without launching PlatformIO or changing project files. */
import { beforeEach, expect, test, vi } from "vitest";
import { buildProject, checkProject, cleanProject } from "../src/tools/build.js";
import { executeWithSpooling } from "../src/utils/spooler.js";
import { invalidateBuildCache } from "../src/utils/build-cache.js";

vi.mock("../src/utils/command-log.js", () => ({ readCommandOutput: async () => '[{"env":"native","tool":"cppcheck","succeeded":true,"defects":[]}]' }));
vi.mock("../src/utils/spooler.js", () => ({ executeWithSpooling: vi.fn() }));
vi.mock("../src/utils/build-cache.js", () => ({ invalidateBuildCache: vi.fn() }));
vi.mock("../src/utils/validation.js", () => ({
  validateProjectPath: (value: string) => value,
  validateEnvironmentName: (value: string) => /^[a-zA-Z0-9_-]+$/.test(value),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(executeWithSpooling).mockResolvedValue({ exitCode: 0, finalOutput: "", fullLogPath: "clean.log" });
});

test("existing callers retain clean target, timeout and response", async () => {
  await expect(cleanProject("workspace")).resolves.toEqual({ success: true, message: "Successfully cleaned build artifacts" });
  expect(executeWithSpooling).toHaveBeenCalledWith("run", ["--target", "clean"], expect.objectContaining({ timeout: 60000, cwd: "workspace" }));
});

test("full cleanup selects the requested environment and invalidates cached builds", async () => {
  await cleanProject("workspace", false, { environment: "esp32", full: true });
  expect(invalidateBuildCache).toHaveBeenCalledWith("workspace");
  expect(executeWithSpooling).toHaveBeenCalledWith("run", ["--target", "fullclean", "--environment", "esp32"], expect.objectContaining({ background: false }));
});

test("invalid cleanup options fail before cache mutation or command dispatch", async () => {
  await expect(cleanProject("workspace", false, { environment: "--other" + " value" })).rejects.toThrow("Invalid environment");
  await expect(cleanProject("workspace", false, { full: "yes" as unknown as boolean })).rejects.toThrow("must be a boolean");
  expect(invalidateBuildCache).not.toHaveBeenCalled();
  expect(executeWithSpooling).not.toHaveBeenCalled();
});


test("fresh build passes jobs and timeout and observes nonzero output without a cache replay", async () => {
  const result = { exitCode: 2, finalOutput: "compile failed", fullLogPath: "build.log" };
  vi.mocked(executeWithSpooling).mockResolvedValueOnce(result);
  const onResult = vi.fn().mockResolvedValue(undefined);
  const built = await buildProject("workspace", "esp32", false, false, { jobs: 4, forceExecution: true, timeoutMs: 1200000, onResult });
  expect(built.success).toBe(false);
  expect(onResult).toHaveBeenCalledWith(result);
  expect(executeWithSpooling).toHaveBeenCalledWith("run", ["--environment", "esp32", "--jobs", "4"], expect.objectContaining({ timeout: 1200000 }));
});


test("structured check forwards severity range and literal filters through the shared spooler", async () => {
  const onResult = vi.fn().mockResolvedValue(undefined);
  await checkProject("workspace", "native", false, { severity: "medium", pattern: "src/*.cpp", tool: "cppcheck", skipPackages: true, jsonOutput: true, timeoutMs: 1200000, onResult });
  expect(executeWithSpooling).toHaveBeenCalledWith("check", ["--json-output", "--severity", "medium", "--severity", "high", "--pattern", "src/*.cpp", "--skip-packages", "--tool", "cppcheck", "--environment", "native"], expect.objectContaining({ timeout: 1200000 }));
  expect(onResult).toHaveBeenCalledOnce();
});


test("canonical foreground checker exposes structured reports when requested", async () => {
  const result = await checkProject("workspace", "native", false, { jsonOutput: true });
  expect(result).toMatchObject({ success: true, analysisReport: { defect_count: 0, tools: [{ tool: "cppcheck", succeeded: true }] }, rawLogPath: "clean.log" });
});
