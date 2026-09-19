/** Reference field mapping and rejection checks without launching PlatformIO. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  mapProjectCompatibilityRequest,
  projectCompatibilityResult,
} from "../src/adapters/project-compat.js";
import {
  parseProjectEnvironments,
  parseProjectMetadata,
} from "../src/core/project-inspection.js";

it("resolves launch defaults and maps only supported request fields", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pio-project-compat-"));
  try {
    await fs.writeFile(
      path.join(root, "platformio.ini"),
      "[env:test]\nplatform=native\n",
    );
    const mapped = await mapProjectCompatibilityRequest(
      "pio_project_metadata",
      { env: "test", approval_id: "scoped" },
      { projectDir: root },
    );
    expect(mapped).toEqual({
      action: "project_metadata",
      args: {
        projectDir: await fs.realpath(root),
        environment: "test",
        approvalId: "scoped",
      },
    });
    await expect(
      mapProjectCompatibilityRequest(
        "pio_project_envs",
        { approved: true },
        { projectDir: root },
      ),
    ).rejects.toMatchObject({ code: "COMPAT_ARGUMENT_INVALID" });
    await expect(
      mapProjectCompatibilityRequest(
        "pio_project_envs",
        { env: "test" },
        { projectDir: root },
      ),
    ).rejects.toMatchObject({ code: "COMPAT_ARGUMENT_INVALID" });
    await expect(
      mapProjectCompatibilityRequest(
        "pio_project_init",
        {},
        { projectDir: root },
      ),
    ).rejects.toMatchObject({ code: "COMPAT_TOOL_UNKNOWN" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("retains resolved environment configuration and explicit defaults", () => {
  const report = parseProjectEnvironments(
    JSON.stringify([
      ["platformio", [["default_envs", ["test"]]]],
      [
        "env:test",
        [
          ["board", "native"],
          ["monitor_speed", 115200],
          ["lib_deps", ["owner/lib"]],
          ["extends", ["shared"]],
        ],
      ],
    ]),
  );
  const result = projectCompatibilityResult({
    ok: true,
    exitCode: 0,
    projectDir: "/project",
    summary: "resolved",
    ...report,
  });
  expect(result).toMatchObject({
    ok: true,
    default_envs: ["test"],
    platformio_ini_path: path.join("/project", "platformio.ini"),
    envs: [
      {
        name: "test",
        board: "native",
        monitor_speed: 115200,
        lib_deps: ["owner/lib"],
        extends: ["shared"],
      },
    ],
  });
});

it("projects bounded metadata and preserves failure instead of inventing successful data", () => {
  const report = parseProjectMetadata(
    JSON.stringify({
      test: {
        includes: {
          build: Array.from({ length: 45 }, (_, n) => `/include/${n}`),
          toolchain: ["/tool"],
        },
        prog_path: "/firmware.elf",
        defines: ["BOARD_TEST"],
        cxx_path: "/compiler",
      },
    }),
  );
  const result = projectCompatibilityResult({
    ok: true,
    exitCode: 0,
    projectDir: "/project",
    summary: "metadata",
    envs: report.envs,
  });
  expect(result).toMatchObject({
    envs: {
      test: {
        toolchain_include_dirs_count: 1,
        program_path: "/firmware.elf",
        cxx: "/compiler",
        defines: ["BOARD_TEST"],
      },
    },
  });
  if ("envs" in result && !Array.isArray(result.envs))
    expect(result.envs.test.include_dirs).toHaveLength(40);
  expect(
    projectCompatibilityResult({
      ok: false,
      exitCode: 1,
      projectDir: "/project",
      summary: "failed",
      outputTail: "failure",
    }),
  ).toMatchObject({
    ok: false,
    error: "PROJECT_INSPECTION_FAILED",
    output_tail: "failure",
  });
});
