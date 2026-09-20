/** Project initialization preserves ordered argv and rejects malformed options before creating files. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const execute = vi.hoisted(() => vi.fn());
vi.mock("../src/platformio.js", () => ({ platformioExecutor: { execute } }));
import { initProject } from "../src/tools/projects.js";
const roots: string[] = [];
function destination() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-init-options-"));
  roots.push(root);
  return path.join(root, "new-project");
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error("Invalid fixture root");
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
  vi.resetAllMocks();
});
it("retains repeated option ordering without interpreting values as shell syntax", async () => {
  execute.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  const projectDir = destination();
  await initProject({
    board: "esp32dev",
    projectDir,
    framework: "arduino",
    projectOptions: ["build_flags=-DFIRST", "build_flags=-DSECOND=$value"],
  });
  expect(execute).toHaveBeenCalledWith(
    "project",
    [
      "init",
      "--board",
      "esp32dev",
      "--project-option",
      "framework=arduino",
      "--project-option",
      "build_flags=-DFIRST",
      "--project-option",
      "build_flags=-DSECOND=$value",
    ],
    { cwd: projectDir, timeout: 120000 },
  );
});
it("rejects invalid options before creating the destination or invoking PlatformIO", async () => {
  const projectDir = destination();
  await expect(
    initProject({
      board: "esp32dev",
      projectDir,
      projectOptions: ["--bad-option"],
    }),
  ).rejects.toThrow();
  expect(fs.existsSync(projectDir)).toBe(false);
  expect(execute).not.toHaveBeenCalled();
});
it("supports the compatibility timeout and reports execution output to trusted logging", async () => {
  const result = { exitCode: 0, stdout: "created", stderr: "" };
  execute.mockResolvedValue(result);
  const onResult = vi.fn(async () => {});
  await initProject({ board: "esp32dev", projectDir: destination() }, { timeoutMs: 600000, onResult });
  expect(execute.mock.calls[0][2].timeout).toBe(600000);
  expect(onResult).toHaveBeenCalledWith(result);
});
