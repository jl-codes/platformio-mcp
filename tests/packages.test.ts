/** Package evidence, authorization and dependency persistence regression tests. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { parsePackageList, parsePackageSearch } from "../src/core/packages.js";
import { mergePackageConfiguration } from "../src/core/package-config.js";
import { executePackageAction } from "../src/tools/packages.js";
import { platformioExecutor } from "../src/platformio.js";
import { approveRequest } from "../src/core/policy/approvals.js";
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: { execute: vi.fn() },
}));
let root: string, project: string;
const searchOutput =
  "Found 2 packages (page 1 of 1)\n\nowner/Library With Spaces\nLibrary \u2022 1.2.3 \u2022 Published on date\nA library.\n\nplatformio/native\nOfficial Platform \u2022 1.2.0 \u2022 Published on date\nA platform.";
const treeOutput =
  "Resolving esp dependencies...\nPlatform espressif32 @ 7.0.1 (required: espressif32@7.0.1)\n\u2514\u2500\u2500 toolchain-xtensa @ 8.4.0 (required: ~8.4)\nLibraries\n\u2514\u2500\u2500 Local Fixture @ 1.0.0 (required: file:///fixture)\nResolving second dependencies...\nLibraries\n\u2514\u2500\u2500 Local Fixture @ 2.0.0 (required: ^2)";
beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-packages-"));
  project = path.join(root, "project");
  fs.mkdirSync(project);
  vi.stubEnv("PIO_MCP_DATA_DIR", path.join(root, "operator"));
  fs.writeFileSync(
    path.join(project, "platformio.ini"),
    "; retain me\n[env:fixture]\nplatform = native\n; baud comment\nmonitor_speed = 115200\n",
  );
  vi.mocked(platformioExecutor.execute).mockResolvedValue({
    exitCode: 0,
    stdout: "Done",
    stderr: "",
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it("parses registry identities, spaces and typed package metadata", () => {
  expect(parsePackageSearch(searchOutput)).toMatchObject({
    total: 2,
    page: 1,
    pages: 1,
    parseStatus: "complete",
    packages: [
      { spec: "owner/Library With Spaces", version: "1.2.3", kind: "library" },
      { spec: "platformio/native", kind: "platform" },
    ],
  });
  expect(
    parsePackageSearch("Nothing has been found by your request"),
  ).toMatchObject({ total: 0, parseStatus: "complete", packages: [] });
  expect(parsePackageSearch("new output format").parseStatus).toBe(
    "unrecognized",
  );
  expect(parsePackageSearch("Found 3 packages (page 1 of 1)").parseStatus).toBe(
    "partial",
  );
});
it("retains package environment and kinds without inventing owners", () => {
  const result = parsePackageList(treeOutput);
  expect(result.parseStatus).toBe("complete");
  expect(result.packages).toHaveLength(4);
  expect(result.packages[1]).toMatchObject({
    kind: "tool",
    environment: "esp",
  });
  expect(result.packages[2]).toMatchObject({
    kind: "library",
    environment: "esp",
    name: "Local Fixture",
    version: "1.0.0",
  });
  expect(result.packages[3]).toMatchObject({
    environment: "second",
    version: "2.0.0",
  });
  expect(result.packages.every((row) => row.spec === undefined)).toBe(true);
  expect(
    parsePackageList("Resolving fixture dependencies...\nNo packages")
      .parseStatus,
  ).toBe("complete");
  expect(
    parsePackageList("Libraries\n\u2514\u2500\u2500 unexpected format")
      .parseStatus,
  ).toBe("partial");
});
it("bounds parser input and returned packages", () => {
  expect(() => parsePackageSearch("x".repeat(16385))).toThrow();
  const result = parsePackageList(
    "Libraries\n" + "\u2514\u2500\u2500 lib @ 1 (required: ^1)\n".repeat(2001),
  );
  expect(result.packages).toHaveLength(2000);
  expect(result.truncated).toBe(true);
});
it.each(["library", "platform", "tool"] as const)(
  "passes %s specifications intact and persists configuration through PlatformIO",
  async (kind) => {
    const keys = {
      library: "lib_deps",
      platform: "platform",
      tool: "platform_packages",
    };
    vi.mocked(platformioExecutor.execute).mockImplementation(async () => {
      const target = path.join(project, "platformio.ini");
      fs.writeFileSync(
        target,
        `[env:fixture]\nplatform = ${kind === "platform" ? "owner/pkg@^2" : "native"}\nmonitor_speed = 115200\n${kind === "platform" ? "" : keys[kind] + " = owner/pkg@^2\n"}`,
      );
      return { exitCode: 0, stdout: "installed", stderr: "" };
    });
    const result = await executePackageAction("pkg_install", {
      projectDir: project,
      environment: "fixture",
      kind,
      spec: "owner/pkg@^2",
    });
    expect(result).toMatchObject({
      ok: true,
      configuration: { changed: true },
    });
    expect(platformioExecutor.execute).toHaveBeenCalledWith(
      "pkg",
      [
        "install",
        "--project-dir",
        fs.realpathSync(project),
        "--environment",
        "fixture",
        `--${kind}`,
        "owner/pkg@^2",
      ],
      expect.objectContaining({ timeout: 900000 }),
    );
    const ini = fs.readFileSync(path.join(project, "platformio.ini"), "utf8");
    expect(ini).toContain("; retain me");
    expect(ini).toContain("; baud comment\nmonitor_speed = 115200");
    expect(fs.readFileSync(result.logPath!, "utf8")).toBe("installed");
  },
);
it("preserves unrelated text, inline comments, multiline dependencies, CRLF and inherited defaults", () => {
  const before =
    "; intro\r\n[env]\r\nbuild_flags = -DTEST ; keep flag\r\n[env:fixture]\r\nplatform = native\r\nlib_deps = old@1 ; reason\r\n    other@2\r\n    ; nested note\r\n    third@3\r\nmonitor_speed=115200\r\n";
  const after =
    "[env]\nbuild_flags = -DTEST\n[env:fixture]\nplatform = native\nlib_deps = new@1\n  other@2\nmonitor_speed = 115200\n";
  const merged = mergePackageConfiguration(before, after, {
    environment: "fixture",
    keys: ["lib_deps"],
  });
  expect(merged).toContain(
    "; intro\r\n[env]\r\nbuild_flags = -DTEST ; keep flag",
  );
  expect(merged).toContain(
    "; reason\r\n    ; nested note\r\nlib_deps = new@1\r\n    other@2",
  );
  expect(merged).toContain("monitor_speed=115200\r\n");
});
it("rejects unexpected configuration or scope changes", () => {
  expect(() =>
    mergePackageConfiguration("[env:a]\nx=1", "[env:a]\nx=2", {
      keys: ["lib_deps"],
    }),
  ).toThrow();
  expect(() =>
    mergePackageConfiguration(
      "[env:a]\nlib_deps=one",
      "[env:a]\nlib_deps=two",
      { keys: ["lib_deps"], environment: "other" },
    ),
  ).toThrow();
  expect(() =>
    mergePackageConfiguration("[env:a]\nx=1\nx=2", "[env:a]\nx=1", {
      keys: [],
    }),
  ).toThrow();
});
it("rejects unknown fields, unsafe options and credential URLs before execution", async () => {
  for (const extra of [
    { spec: "--global" },
    { global: true },
    { kind: "python" },
    { environment: "--help" },
    { spec: "https://name:password@host/repo.git" },
  ])
    await expect(
      executePackageAction("pkg_install", {
        projectDir: project,
        spec: "owner/pkg",
        ...extra,
      }),
    ).rejects.toThrow();
  expect(platformioExecutor.execute).not.toHaveBeenCalled();
});
it("blocks all project package operations under read-only policy before ledger or lock effects", async () => {
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    '{"profile":"read_only"}',
  );
  const callback = vi.fn();
  for (const action of [
    "pkg_install",
    "pkg_uninstall",
    "pkg_update",
    "pkg_list",
    "pkg_outdated",
  ] as const)
    await expect(
      executePackageAction(
        action,
        {
          projectDir: project,
          ...(action === "pkg_install" || action === "pkg_uninstall"
            ? { spec: "owner/pkg" }
            : {}),
        },
        {},
        callback,
      ),
    ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(platformioExecutor.execute).not.toHaveBeenCalled();
  expect(callback).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(project, ".pio-mcp-packages.lock"))).toBe(
    false,
  );
});
it("binds one-use grants to the package, environment, kind and operation", async () => {
  fs.mkdirSync(path.join(root, "operator"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "operator", "policy.yaml"),
    "approval_required: [install_library]\n",
  );
  const params = {
    projectDir: project,
    spec: "owner/pkg@1",
    environment: "fixture",
  };
  let approvalId: string;
  try {
    await executePackageAction("pkg_install", params);
    throw new Error("approval expected");
  } catch (error: any) {
    approvalId = error.context.policyDecision.approvalId;
  }
  approveRequest(approvalId!);
  await expect(
    executePackageAction("pkg_install", {
      ...params,
      approvalId: approvalId!,
      spec: "other/pkg",
    }),
  ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  expect(platformioExecutor.execute).not.toHaveBeenCalled();
  expect(
    (
      await executePackageAction("pkg_install", {
        ...params,
        approvalId: approvalId!,
      })
    ).ok,
  ).toBe(true);
  await expect(
    executePackageAction("pkg_install", { ...params, approvalId: approvalId! }),
  ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  expect(platformioExecutor.execute).toHaveBeenCalledTimes(1);
});
it("keeps failed exit status and redacts persisted output", async () => {
  vi.mocked(platformioExecutor.execute).mockResolvedValue({
    exitCode: 2,
    stdout: "partial",
    stderr: "https://user:password@host/repo password=fixture-private-value",
  });
  const result = await executePackageAction("pkg_uninstall", {
    projectDir: project,
    spec: "owner/pkg",
  });
  expect(result).toMatchObject({
    ok: false,
    exitCode: 2,
    error: "PACKAGE_COMMAND_FAILED",
  });
  const output = fs.readFileSync(result.logPath!, "utf8");
  expect(output).not.toContain("fixture-private-value");
  expect(output).not.toContain("user:password");
  expect(result.outputTail).toContain("partial");
});
it("does not interpret an unrecognized successful list as an empty dependency set", async () => {
  const result = await executePackageAction("pkg_list", {
    projectDir: project,
  });
  expect(result).toMatchObject({
    ok: false,
    exitCode: 0,
    parseStatus: "unrecognized",
  });
});
it("rechecks policy after adapter callbacks and always releases the project lock", async () => {
  await expect(
    executePackageAction(
      "pkg_update",
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
  fs.unlinkSync(path.join(project, ".pio-mcp-policy.json"));
  vi.mocked(platformioExecutor.execute).mockRejectedValue(
    new Error("process failure"),
  );
  await expect(
    executePackageAction("pkg_update", { projectDir: project }),
  ).rejects.toThrow("process failure");
  expect(fs.existsSync(path.join(project, ".pio-mcp-packages.lock"))).toBe(
    false,
  );
});
it("rejects a competing project mutation and releases ownership for the next operation", async () => {
  let finish!: (result: {
    exitCode: number;
    stdout: string;
    stderr: string;
  }) => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.mocked(platformioExecutor.execute).mockImplementationOnce(() => {
    started();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const first = executePackageAction("pkg_update", { projectDir: project });
  await waiting;
  await expect(
    executePackageAction("pkg_update", { projectDir: project }),
  ).rejects.toMatchObject({ code: "ELOCKED" });
  finish({ exitCode: 0, stdout: "done", stderr: "" });
  await first;
  expect(
    (await executePackageAction("pkg_update", { projectDir: project })).ok,
  ).toBe(true);
});

it("supports the reference's empty search query for a whole package kind", async () => {
  vi.mocked(platformioExecutor.execute).mockResolvedValue({
    exitCode: 0,
    stdout: searchOutput,
    stderr: "",
  });
  expect(
    (await executePackageAction("pkg_search", { query: "", kind: "tool" })).ok,
  ).toBe(true);
  expect(platformioExecutor.execute).toHaveBeenCalledWith(
    "pkg",
    ["search", "type:tool", "--page", "1"],
    expect.anything(),
  );
});
