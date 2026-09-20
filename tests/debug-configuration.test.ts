/** Reference environment selection and permission-scoped debugger configuration collection. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { platformioExecutor } from "../src/platformio.js";
import {
  collectDebugConfiguration,
  selectDebugConfiguration,
} from "../src/core/debug/debug-configuration.js";
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: { execute: vi.fn() },
}));
const configuration = JSON.stringify([
  ["platformio", [["default_envs", ["release", "debug"]]]],
  ["env:release", [["build_type", "release"]]],
  [
    "env:debug",
    [
      ["build_type", "debug"],
      ["debug_tool", "esp-prog"],
    ],
  ],
  ["env:other", [["build_type", "debug"]]],
]);
let project: string;
beforeEach(() => {
  project = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "pio-debug-config-")),
  );
  vi.mocked(platformioExecutor.execute).mockReset();
});
afterEach(() => fs.rmSync(project, { recursive: true, force: true }));
it("prefers a debug default while retaining an explicit release selection", () => {
  expect(selectDebugConfiguration(configuration)).toEqual({
    environment: "debug",
    debugTool: "esp-prog",
    buildType: "debug",
  });
  expect(selectDebugConfiguration(configuration, "release").environment).toBe(
    "release",
  );
  expect(selectDebugConfiguration(configuration, "other").environment).toBe(
    "other",
  );
});
it("uses declared defaults before unrelated debug environments", () => {
  const raw = JSON.parse(configuration);
  raw[0][1][0][1] = ["release"];
  expect(selectDebugConfiguration(JSON.stringify(raw)).environment).toBe(
    "release",
  );
  raw.shift();
  expect(selectDebugConfiguration(JSON.stringify(raw)).environment).toBe(
    "debug",
  );
});
it("rejects absent, unknown, and option-like environment selections", () => {
  for (const env of ["missing", "--upload", ""])
    expect(() => selectDebugConfiguration(configuration, env)).toThrow();
  expect(() => selectDebugConfiguration("[]")).toThrow();
});
it("rejects duplicate sections and invalid debug tool values", () => {
  expect(() =>
    selectDebugConfiguration('[ ["env:a", []], ["env:a", []] ]'),
  ).toThrow();
  expect(() =>
    selectDebugConfiguration('[ ["env:a", [["debug_tool", ["openocd"]]]] ]'),
  ).toThrow();
});
it("collects bounded configuration without starting debug or build commands", async () => {
  vi.mocked(platformioExecutor.execute).mockResolvedValue({
    stdout: configuration,
    stderr: "",
    exitCode: 0,
  });
  expect(
    (await collectDebugConfiguration({ projectDir: project })).environment,
  ).toBe("debug");
  expect(platformioExecutor.execute).toHaveBeenCalledExactlyOnceWith(
    "project",
    ["config", "--json-output"],
    { cwd: project, timeout: 30000 },
  );
});
it("rejects failed collection and never parses stale successful-looking output", async () => {
  vi.mocked(platformioExecutor.execute).mockResolvedValue({
    stdout: configuration,
    stderr: "",
    exitCode: 1,
  });
  await expect(
    collectDebugConfiguration({ projectDir: project }),
  ).rejects.toMatchObject({ code: "DEBUG_CONFIG_FAILED" });
});
it("denies configuration before invoking Core when its concrete action is denied", async () => {
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { deny: ["get_project_config"] },
    }),
  );
  await expect(
    collectDebugConfiguration({ projectDir: project }),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(platformioExecutor.execute).not.toHaveBeenCalled();
});
