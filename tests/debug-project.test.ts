/** Debugger preparation composes build policy, selected artifacts and trusted tools before probe work. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { platformioExecutor } from "../src/platformio.js";
import { getSystemInfo } from "../src/tools/projects.js";
import { collectDebugConfiguration } from "../src/core/debug/debug-configuration.js";
import { resolveDebugConfiguration } from "../src/core/debug/debug-resolved-config.js";
import {
  discoverDebuggerRoots,
  resolveDebuggerExecutable,
} from "../src/core/debug/debug-discovery.js";
import { prepareDebuggerProject } from "../src/core/debug/debug-project.js";
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: { execute: vi.fn() },
}));
vi.mock("../src/tools/projects.js", () => ({ getSystemInfo: vi.fn() }));
vi.mock("../src/core/debug/debug-configuration.js", () => ({
  collectDebugConfiguration: vi.fn(),
}));
vi.mock("../src/core/debug/debug-resolved-config.js", () => ({
  resolveDebugConfiguration: vi.fn(),
}));
vi.mock("../src/core/debug/debug-discovery.js", () => ({
  discoverDebuggerRoots: vi.fn(),
  resolveDebuggerExecutable: vi.fn(),
}));
let root: string, project: string, elf: string;
let resolved: Awaited<ReturnType<typeof resolveDebugConfiguration>>;
function writeElf(file: string) {
  const bytes = Buffer.alloc(128);
  bytes.write("7f454c46", 0, "hex");
  bytes[4] = 1;
  bytes[5] = 1;
  bytes[6] = 1;
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(94, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeUInt16LE(52, 40);
  fs.writeFileSync(file, bytes);
}
beforeEach(() => {
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "pio-debug-project-")),
  );
  project = path.join(root, "project");
  fs.mkdirSync(project);
  elf = path.join(project, "firmware.elf");
  writeElf(elf);
  vi.resetAllMocks();
  vi.mocked(collectDebugConfiguration).mockResolvedValue({
    environment: "debug",
    debugTool: "esp-prog",
    buildType: "debug",
  });
  vi.mocked(platformioExecutor.execute).mockResolvedValue({
    exitCode: 0,
    stdout: "build complete",
    stderr: "",
  });
  vi.mocked(getSystemInfo).mockResolvedValue({ core_dir: { value: root } });
  resolved = {
    environment: "debug",
    debuggerPath: path.join(root, "gdb"),
    elfPath: elf,
    debugTool: "esp-prog",
    server: null,
    port: ":3333",
    readyPattern: null,
    initScript: "",
    initCommands: [],
    extraCommands: [],
    loadCommands: ["load"],
    initBreak: "tbreak main",
    loadMode: "always",
  };
  vi.mocked(resolveDebugConfiguration).mockResolvedValue(resolved);
  vi.mocked(discoverDebuggerRoots).mockResolvedValue([root]);
  vi.mocked(resolveDebuggerExecutable).mockResolvedValue(
    path.join(root, "gdb"),
  );
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
it("builds the selected debug environment without starting a debugger interface", async () => {
  const result = await prepareDebuggerProject({ projectDir: project });
  expect(platformioExecutor.execute).toHaveBeenCalledExactlyOnceWith(
    "debug",
    ["--environment", "debug"],
    { cwd: project, timeout: expect.any(Number) },
  );
  expect(result).toMatchObject({
    environment: "debug",
    elfPath: elf,
    executable: path.join(root, "gdb"),
    expectedElfSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    firmwareIdentity: { architecture: "xtensa", size: 128 },
  });
  expect(resolveDebugConfiguration).toHaveBeenCalledWith(
    expect.objectContaining({ timeoutMs: 90000, deadline: expect.any(Number) }),
    expect.objectContaining({ workspaceDir: project }),
  );
});
it("stops on build failure before system discovery or backend resolution", async () => {
  vi.mocked(platformioExecutor.execute).mockResolvedValue({
    exitCode: 1,
    stdout: "",
    stderr: "private build error",
  });
  await expect(
    prepareDebuggerProject({ projectDir: project }),
  ).rejects.toMatchObject({ code: "DEBUG_BUILD_FAILED" });
  expect(getSystemInfo).not.toHaveBeenCalled();
  expect(resolveDebugConfiguration).not.toHaveBeenCalled();
});
it("read-only policy denies debug build before Core execution", async () => {
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    JSON.stringify({ profile: "read_only" }),
  );
  await expect(
    prepareDebuggerProject({ projectDir: project }),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(platformioExecutor.execute).not.toHaveBeenCalled();
});
it("refuses an ELF outside the authorized project", async () => {
  const outside = path.join(root, "outside.elf");
  writeElf(outside);
  vi.mocked(resolveDebugConfiguration).mockResolvedValue({
    ...resolved,
    elfPath: outside,
  });
  await expect(
    prepareDebuggerProject({ projectDir: project }),
  ).rejects.toMatchObject({ code: "DEBUG_ELF_OUTSIDE_WORKSPACE" });
});
it("cancellation after the build prevents later preparation stages", async () => {
  const controller = new AbortController();
  vi.mocked(platformioExecutor.execute).mockImplementation(async () => {
    controller.abort();
    return { exitCode: 0, stdout: "", stderr: "" };
  });
  await expect(
    prepareDebuggerProject({ projectDir: project }, {}, controller.signal),
  ).rejects.toMatchObject({ code: "DEBUG_CANCELLED" });
  expect(resolveDebugConfiguration).not.toHaveBeenCalled();
});
it("refuses invalid public arguments before configuration or process execution", async () => {
  await expect(
    prepareDebuggerProject({ projectDir: project, environment: "--upload" }),
  ).rejects.toMatchObject({ code: "DEBUG_ARGUMENT_INVALID" });
  expect(collectDebugConfiguration).not.toHaveBeenCalled();
});
