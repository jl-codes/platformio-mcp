/** Resolved backend configuration stays inert and collection requires build permission. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runAnalysisProcess } from "../src/core/analysis/analysis-process.js";
import {
  parseResolvedDebugConfiguration,
  resolveDebugConfiguration,
} from "../src/core/debug/debug-resolved-config.js";
vi.mock("../src/core/analysis/analysis-process.js", () => ({
  runAnalysisProcess: vi.fn(),
}));
let root: string, project: string, python: string;
function config() {
  return {
    environment: "debug",
    debuggerPath: path.join(root, "toolchain", "gdb"),
    elfPath: path.join(project, ".pio", "build", "debug", "firmware.elf"),
    debugTool: "esp-prog",
    server: {
      cwd: path.join(root, "openocd"),
      executable: "bin/openocd",
      arguments: ["-f", "board/esp32.cfg"],
    },
    port: ":3333",
    readyPattern: "Listening on port",
    initScript: "monitor init\n$LOAD_CMDS\n",
    initCommands: [],
    extraCommands: [],
    loadCommands: ["load"],
    initBreak: "tbreak main",
    loadMode: "modified",
  };
}
function input() {
  return {
    projectDir: project,
    environment: "debug",
    systemInfo: { python_exe: { value: python } },
  };
}
beforeEach(() => {
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "pio-debug-resolved-")),
  );
  project = path.join(root, "project");
  fs.mkdirSync(project);
  python = path.join(root, "python.exe");
  fs.writeFileSync(python, "fixture interpreter; never executed");
  vi.stubEnv("PIO_MCP_DEBUG_PYTHON", "");
  delete process.env.PIO_MCP_DEBUG_PYTHON;
  vi.mocked(runAnalysisProcess).mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
it("preserves backend argument boundaries and inert initialization commands", () => {
  const data = config();
  data.extraCommands = ["shell echo explicit-host-code"];
  const result = parseResolvedDebugConfiguration(
    JSON.stringify(data),
    project,
    "debug",
  );
  expect(result.server).toEqual({
    cwd: path.join(root, "openocd"),
    executable: path.join(root, "openocd", "bin", "openocd"),
    arguments: ["-f", "board/esp32.cfg"],
  });
  expect(result.extraCommands).toEqual(data.extraCommands);
  expect(runAnalysisProcess).not.toHaveBeenCalled();
});
it("preserves externally managed server configuration without inventing a backend", () => {
  expect(
    parseResolvedDebugConfiguration(
      JSON.stringify({ ...config(), server: null }),
      project,
      "debug",
    ).server,
  ).toBeNull();
});
it("rejects wrong environment, relative GDB, oversized output and shell backends", () => {
  for (const data of [
    { ...config(), environment: "other" },
    { ...config(), debuggerPath: "gdb" },
    {
      ...config(),
      server: { executable: "launch.cmd", cwd: root, arguments: [] },
    },
  ])
    expect(() =>
      parseResolvedDebugConfiguration(JSON.stringify(data), project, "debug"),
    ).toThrow();
  expect(() =>
    parseResolvedDebugConfiguration(
      " ".repeat(1024 * 1024 + 1),
      project,
      "debug",
    ),
  ).toThrow();
});
it("collects using isolated Python and bounded output with an explicit build purpose", async () => {
  vi.mocked(runAnalysisProcess).mockResolvedValue({
    stdout: JSON.stringify(config()),
    stderr: "private hook logs",
  });
  expect((await resolveDebugConfiguration(input())).debugTool).toBe("esp-prog");
  expect(runAnalysisProcess).toHaveBeenCalledExactlyOnceWith(
    python,
    ["-I", "-c", expect.any(String), "debug"],
    expect.objectContaining({
      cwd: project,
      timeoutMs: 90000,
      maxOutputBytes: 1024 * 1024,
    }),
  );
});
it("read-only profile rejects resolution before invoking Python", async () => {
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    JSON.stringify({ profile: "read_only" }),
  );
  await expect(resolveDebugConfiguration(input())).rejects.toMatchObject({
    code: "POLICY_DENIED",
  });
  expect(runAnalysisProcess).not.toHaveBeenCalled();
});
it("rejects a workspace-controlled Python interpreter", async () => {
  python = path.join(project, "python.exe");
  fs.writeFileSync(python, "untrusted");
  await expect(resolveDebugConfiguration(input())).rejects.toMatchObject({
    code: "DEBUG_PYTHON_UNTRUSTED",
  });
  expect(runAnalysisProcess).not.toHaveBeenCalled();
});
it("does not expose output from a failed resolver", async () => {
  vi.mocked(runAnalysisProcess).mockResolvedValue({
    stdout: "secret hook output, not JSON",
    stderr: "secret",
  });
  await expect(resolveDebugConfiguration(input())).rejects.toMatchObject({
    code: "DEBUG_RESOLVED_CONFIG_INVALID",
    message: "Invalid resolved debugger configuration.",
  });
});
it("rejects invalid deadline or option-like environment before any process", async () => {
  for (const override of [
    { timeoutMs: 0 },
    { timeoutMs: 120001 },
    { environment: "--upload" },
  ])
    await expect(
      resolveDebugConfiguration({ ...input(), ...override }),
    ).rejects.toThrow();
  expect(runAnalysisProcess).not.toHaveBeenCalled();
});
