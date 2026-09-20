/** CLI argument/permission acceptance; no PlatformIO scripts or hardware are executed. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { beforeEach, afterEach, it, expect } from "vitest";
let project: string;
beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "pio-cli-analysis-"));
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    '{"profile":"read_only"}',
  );
});
afterEach(() => fs.rmSync(project, { recursive: true, force: true }));
function run(command: string, ...args: string[]) {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/cli.ts",
      command,
      "--project-dir",
      project,
      "--environment",
      "fixture",
      "--json",
      ...args,
    ],
    { cwd: process.cwd(), env: process.env, encoding: "utf8", timeout: 15000 },
  );
  expect(result.status).toBe(1);
  return JSON.parse(result.stderr);
}
it("routes both CLI analysis commands through policy without executing scripts", () => {
  expect(run("size-report").errorType).toBe("PolicyDenied");
  const log = path.join(project, "crash.txt");
  fs.writeFileSync(log, "PC: 0x08001234");
  expect(run("decode-backtrace", "--text-file", log).errorType).toBe(
    "PolicyDenied",
  );
  expect(fs.existsSync(path.join(project, ".pio"))).toBe(false);
});
it("rejects mutually ambiguous and missing crash input", () => {
  expect(run("decode-backtrace").errorType).toBe("ANALYSIS_INPUT_INVALID");
  expect(
    run(
      "decode-backtrace",
      "--text",
      "PC: 0x08001234",
      "--text-file",
      "missing",
    ).errorType,
  ).toBe("ANALYSIS_INPUT_INVALID");
});
it("bounds crash file reads", () => {
  const log = path.join(project, "large.txt");
  fs.writeFileSync(log, "x".repeat(1024 * 1024 + 1));
  expect(run("decode-backtrace", "--text-file", log).errorType).toBe(
    "ANALYSIS_INPUT_LIMIT",
  );
});
it("rejects invalid numeric report arguments before policy execution", () =>
  expect(run("size-report", "--top", "invalid").errorType).toBe(
    "InvalidArguments",
  ));

it.each([
  "pkg-list",
  "pkg-outdated",
  "pkg-update",
  "pkg-install",
  "pkg-uninstall",
])(
  "routes %s through policy before execution",
  (command) => {
    const args =
      command === "pkg-install" || command === "pkg-uninstall"
        ? ["--spec", "owner/fixture@1", "--kind", "tool"]
        : [];
    expect(run(command, ...args).errorType).toBe("PolicyDenied");
    expect(fs.existsSync(path.join(project, ".pio-mcp-packages.lock"))).toBe(
      false,
    );
  },
  20000,
);
it("rejects invalid package CLI arguments before invoking PlatformIO", () => {
  expect(
    run("pkg-search", "--query", "fixture", "--page", "invalid").errorType,
  ).toBe("InvalidArguments");
  expect(
    run("pkg-install", "--spec", "fixture", "--kind", "invalid").errorType,
  ).toBe("InvalidArguments");
});

it("does not silently ignore package scope-changing flags", () => {
  expect(run("pkg-install", "--spec", "fixture", "--global").errorType).toBe(
    "PACKAGE_INPUT_INVALID",
  );
  expect(run("pkg-update", "--spec", "fixture").errorType).toBe(
    "PACKAGE_INPUT_INVALID",
  );
});

it("routes project metadata and target discovery through the shared CLI permission boundary", () => {
  for (const command of ["project-metadata", "list-targets"])
    expect(run(command).errorType).toBe("PolicyDenied");
  expect(run("project-envs").errorType).toBe("PROJECT_INPUT_INVALID"); // This helper adds --environment, unsupported for the complete environment inventory.
});

it("rejects invalid dependency flags and honors concrete tool denial", () => {
  expect(run("deps-check", "--build", "maybe").errorType).toBe(
    "DEPENDENCY_INPUT_INVALID",
  );
  expect(run("deps-check", "--approve").errorType).toBe(
    "DEPENDENCY_INPUT_INVALID",
  );
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { deny: ["deps_check"] },
    }),
  );
  expect(run("deps-check").errorType).toBe("PolicyDenied");
  expect(fs.existsSync(path.join(project, ".pio"))).toBe(false);
});


it.each(["clean", "check", "test"])("routes %s CLI through canonical permission before execution", command => {
  expect(run(command).errorType).toBe("PolicyDenied");
  expect(fs.existsSync(path.join(project, ".pio"))).toBe(false);
});

it("routes named-target CLI through effect permission before execution", () => {
  fs.writeFileSync(path.join(project, "platformio.ini"), "[env:fixture]\nplatform=native\n");
  expect(run("run-target", "--target", "buildfs").errorType).toBe("PolicyDenied");
  expect(fs.existsSync(path.join(project, ".pio"))).toBe(false);
});
