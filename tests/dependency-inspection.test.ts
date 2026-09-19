/** Real policy checks around dependency collection with mocked PlatformIO subprocesses. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { inspectDependencies } from "../src/tools/dependency-inspection.js";
import { platformioExecutor } from "../src/platformio.js";
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: { execute: vi.fn() },
}));
let root: string, project: string;
beforeEach(async () => {
  vi.clearAllMocks();
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pio-deps-service-"));
  project = path.join(root, "project");
  await fs.mkdir(project);
  vi.stubEnv("PIO_MCP_DATA_DIR", path.join(root, "state"));
  await fs.writeFile(
    path.join(project, "platformio.ini"),
    "[env:fixture]\nplatform=native",
  );
  await fs.writeFile(
    path.join(project, ".pio-mcp-policy.json"),
    '{"profile":"read_only"}',
  );
  vi.mocked(platformioExecutor.execute).mockResolvedValue({
    exitCode: 0,
    stdout: JSON.stringify([["env:fixture", []]]),
    stderr: "",
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
it("collects inventory with read permission and never implicitly builds", async () => {
  const result = await inspectDependencies({ projectDir: project });
  expect(result).toMatchObject({
    ok: true,
    environment: "fixture",
    build: null,
    inventoryComplete: true,
    graphStatus: "not_collected",
  });
  expect(platformioExecutor.execute).toHaveBeenCalledTimes(1);
});
it("denies optional build under read-only policy before launching it", async () => {
  await expect(
    inspectDependencies({ projectDir: project, build: true }),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(platformioExecutor.execute).toHaveBeenCalledTimes(1);
});
it("does not report success for incomplete installed manifest evidence", async () => {
  await fs.mkdir(path.join(project, "lib", "Broken"), { recursive: true });
  await fs.writeFile(path.join(project, "lib", "Broken", "library.json"), "{");
  expect(await inspectDependencies({ projectDir: project })).toMatchObject({
    ok: false,
    inventoryComplete: false,
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "DEPENDENCY_MANIFEST_INVALID" }),
    ]),
  });
});
