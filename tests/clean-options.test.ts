/** Verify clean target selection without launching PlatformIO or changing project files. */
import { beforeEach, expect, test, vi } from "vitest";
import { cleanProject } from "../src/tools/build.js";
import { executeWithSpooling } from "../src/utils/spooler.js";
import { invalidateBuildCache } from "../src/utils/build-cache.js";

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
