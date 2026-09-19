/** Computed environment, metadata and target-discovery contracts with real policy enforcement. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  parseProjectEnvironments,
  parseProjectMetadata,
} from "../src/core/project-inspection.js";
import { executeProjectInspection } from "../src/tools/project-inspection.js";
import { platformioExecutor } from "../src/platformio.js";
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: { execute: vi.fn() },
}));
let project: string;
beforeEach(() => {
  vi.clearAllMocks();
  project = fs.mkdtempSync(path.join(os.tmpdir(), "pio-inspection-"));
});
afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true });
});
const config = [
  ["platformio", [["default_envs", ["secondary"]]]],
  [
    "env:first",
    [
      ["board", "esp32dev"],
      ["framework", ["arduino"]],
      ["monitor_speed", 115200],
      ["extends", ["base", "common"]],
    ],
  ],
  [
    "env:secondary",
    [
      ["board", "esp32-s3-devkitc-1"],
      ["platform", "espressif32"],
      ["build_flags", ["-DTEST"]],
      ["lib_deps", ["owner/lib@1"]],
    ],
  ],
];
const entry = {
  env_name: "fixture",
  build_type: "debug",
  defines: ["TEST"],
  includes: {
    build: Array.from({ length: 50 }, (_, i) => `/include/${i}`),
    toolchain: ["/toolchain"],
  },
  cc_path: "/compiler/gcc",
  prog_path: "/project/firmware.elf",
  targets: [
    {
      name: "size",
      group: "Platform",
      title: "Program Size",
      description: null,
    },
  ],
  extra: {
    flash_images: [{ offset: "0x8000", path: "/partitions.bin" }],
    access_token: "private-fixture-value",
  },
};
it("preserves resolved fields and declared defaults without selecting the first environment", () => {
  const result = parseProjectEnvironments(JSON.stringify(config));
  expect(result.defaultEnvironments).toEqual(["secondary"]);
  expect(result.envs[0]).toMatchObject({
    name: "first",
    monitorSpeed: 115200,
    framework: ["arduino"],
    extends: ["base", "common"],
  });
  expect(result.envs[1]).toMatchObject({
    name: "secondary",
    libraryDependencies: ["owner/lib@1"],
    buildFlags: ["-DTEST"],
  });
  expect(
    parseProjectEnvironments(JSON.stringify(config.slice(1)))
      .defaultEnvironments,
  ).toEqual(["first", "secondary"]);
});
it("rejects duplicate or malformed config and invalid default environments", () => {
  for (const input of [
    [config[1], config[1]],
    [
      [
        "env:a",
        [
          ["board", "one"],
          ["board", "two"],
        ],
      ],
    ],
    [["platformio", [["default_envs", ["missing"]]]]],
    { arbitrary: "map" },
  ])
    expect(() => parseProjectEnvironments(JSON.stringify(input))).toThrow();
});
it("bounds include paths, keeps image offsets, redacts secret values and exposes typed targets", () => {
  const result = parseProjectMetadata(
    JSON.stringify({ fixture: entry }),
    "fixture",
  );
  expect(result.envs.fixture.includeDirs).toHaveLength(40);
  expect(result.envs.fixture.includeDirCount).toBe(50);
  expect(result.envs.fixture.toolchainIncludeDirCount).toBe(1);
  expect(result.envs.fixture.extra).toMatchObject({
    flash_images: [{ offset: "0x8000", path: "/partitions.bin" }],
    access_token: "[REDACTED_SECRET]",
  });
  expect(result.targets).toEqual([
    {
      environment: "fixture",
      name: "size",
      group: "Platform",
      title: "Program Size",
      description: null,
    },
  ]);
});
it("does not mistake a secret-like environment name for a secret field", () => {
  expect(
    parseProjectMetadata(
      JSON.stringify({
        secret_fixture: { ...entry, env_name: "secret_fixture" },
      }),
    ).envs.secret_fixture,
  ).toBeDefined();
});
it("does not conflate missing target metadata with a known empty inventory", () => {
  expect(parseProjectMetadata('{"fixture":{}}').targetsAvailable).toBe(false);
  expect(
    parseProjectMetadata('{"fixture":{"targets":[]}}').targetsAvailable,
  ).toBe(true);
});
it("rejects wrong environment identities and bounded-output violations", () => {
  expect(() =>
    parseProjectMetadata(JSON.stringify({ other: entry }), "fixture"),
  ).toThrow();
  expect(() =>
    parseProjectMetadata(JSON.stringify({ other: entry })),
  ).toThrow();
  expect(() =>
    parseProjectMetadata("x".repeat(10 * 1024 * 1024 + 1)),
  ).toThrow();
  let nested: unknown = 1;
  for (let i = 0; i < 30; i++) nested = { next: nested };
  expect(() =>
    parseProjectMetadata(JSON.stringify({ fixture: { extra: nested } })),
  ).toThrow();
});
it("allows computed config under read-only policy and uses the explicit project", async () => {
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    '{"profile":"read_only"}',
  );
  vi.mocked(platformioExecutor.execute).mockResolvedValue({
    exitCode: 0,
    stdout: JSON.stringify(config),
    stderr: "",
  });
  expect(
    await executeProjectInspection("project_envs", { projectDir: project }),
  ).toMatchObject({ ok: true, defaultEnvironments: ["secondary"] });
  expect(platformioExecutor.execute).toHaveBeenCalledWith(
    "project",
    ["config", "--json-output", "--project-dir", fs.realpathSync(project)],
    expect.objectContaining({ timeout: 30000 }),
  );
});
it.each(["project_metadata", "list_targets"] as const)(
  "blocks %s project scripts under read-only policy",
  async (action) => {
    fs.writeFileSync(
      path.join(project, ".pio-mcp-policy.json"),
      '{"profile":"read_only"}',
    );
    await expect(
      executeProjectInspection(action, { projectDir: project }),
    ).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(platformioExecutor.execute).not.toHaveBeenCalled();
  },
);
it("uses the structured metadata source for discovery and never executes a discovered target", async () => {
  vi.mocked(platformioExecutor.execute).mockResolvedValue({
    exitCode: 0,
    stdout: JSON.stringify({ fixture: entry }),
    stderr: "",
  });
  expect(
    await executeProjectInspection("list_targets", {
      projectDir: project,
      environment: "fixture",
    }),
  ).toMatchObject({
    ok: true,
    targets: [{ name: "size", environment: "fixture" }],
  });
  expect(platformioExecutor.execute).toHaveBeenCalledWith(
    "project",
    [
      "metadata",
      "--json-output",
      "--project-dir",
      fs.realpathSync(project),
      "--environment",
      "fixture",
    ],
    expect.objectContaining({ timeout: 600000 }),
  );
});
it("keeps subprocess failures and rejects forged inputs", async () => {
  vi.mocked(platformioExecutor.execute).mockResolvedValue({
    exitCode: 2,
    stdout: "partial",
    stderr: "password=fixture-private-value",
  });
  const result = await executeProjectInspection("project_metadata", {
    projectDir: project,
  });
  expect(result).toMatchObject({ ok: false, exitCode: 2 });
  expect(JSON.stringify(result)).not.toContain("fixture-private-value");
  vi.clearAllMocks();
  await expect(
    executeProjectInspection("project_metadata", {
      projectDir: project,
      environment: "--help",
    }),
  ).rejects.toThrow();
  await expect(
    executeProjectInspection("project_envs", {
      projectDir: project,
      __approved: true,
    }),
  ).rejects.toThrow();
  expect(platformioExecutor.execute).not.toHaveBeenCalled();
});
it("rechecks policy after the adapter callback before project execution", async () => {
  await expect(
    executeProjectInspection(
      "list_targets",
      { projectDir: project },
      {},
      async () => {
        fs.writeFileSync(
          path.join(project, ".pio-mcp-policy.json"),
          '{"profile":"read_only"}',
        );
      },
    ),
  ).rejects.toMatchObject({ code: "POLICY_CHANGED" });
  expect(platformioExecutor.execute).not.toHaveBeenCalled();
});
