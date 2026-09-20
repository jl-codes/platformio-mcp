/** Verify cleanup authorization, failure reporting and compiler diagnostics without running PlatformIO. */
import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), clean: vi.fn(), lock: vi.fn(), guard: vi.fn(), log: vi.fn() }));
vi.mock("../src/core/action-dispatcher.js", () => ({ dispatchAuthorizedAction: mocks.dispatch }));
vi.mock("../src/tools/build.js", () => ({ cleanProject: mocks.clean }));
vi.mock("../src/utils/lock-manager.js", () => ({ hardwareLockManager: { withImplicitLock: mocks.lock } }));
vi.mock("../src/core/policy/revision-guard.js", () => ({ createPolicyRevisionGuard: () => mocks.guard }));
vi.mock("../src/adapters/compatibility-project.js", () => ({ resolveCompatibilityProject: async () => "workspace" }));
vi.mock("../src/utils/command-log.js", () => ({ retainCommandLog: mocks.log }));
vi.mock("node:fs/promises", () => ({ default: { open: async () => ({
  stat: async () => ({ size: 0, isFile: () => true }),
  read: async () => ({ bytesRead: 0 }), close: async () => {},
}) } }));
import { executeCleanCompatibility, cleanCompatibilityResult } from "../src/adapters/clean-compat.js";
import { BuildError } from "../src/utils/errors.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatch.mockImplementation((_name, _args, _caller, callback) => callback());
  mocks.lock.mockImplementation(callback => callback());
  mocks.log.mockResolvedValue("redacted-clean.log");
});

test("denied destructive cleanup cannot acquire a lock or execute", async () => {
  mocks.dispatch.mockRejectedValueOnce(new Error("denied"));
  await expect(executeCleanCompatibility({ full: true, env: "esp32", approval_id: "grant" })).rejects.toThrow("denied");
  expect(mocks.dispatch.mock.calls[0].slice(0, 2)).toEqual(["clean_project", { projectDir: "workspace", environment: "esp32", full: true, approvalId: "grant" }]);
  expect(mocks.lock).not.toHaveBeenCalled();
  expect(mocks.clean).not.toHaveBeenCalled();
});

test("nonzero cleanup returns a failed result from the observed execution", async () => {
  mocks.clean.mockImplementation(async (_project, _background, options) => {
    expect(options).toMatchObject({ environment: "esp32", full: true, timeoutMs: 120000 });
    await options.onResult({ exitCode: 2, finalOutput: "", fullLogPath: "raw.log" });
    throw new BuildError("failed", { exitCode: 2 });
  });
  await expect(executeCleanCompatibility({ env: "esp32", full: true })).resolves.toMatchObject({ ok: false, status: "failed", exit_code: 2, log_path: "redacted-clean.log" });
  expect(mocks.lock).toHaveBeenCalledOnce();
});

test("policy revision changes prevent execution after authorization callback", async () => {
  mocks.guard.mockImplementationOnce(() => { throw new Error("policy changed"); });
  await expect(executeCleanCompatibility({})).rejects.toThrow("policy changed");
  expect(mocks.clean).not.toHaveBeenCalled();
});

test("failed build markers override zero exit and diagnostics retain counts beyond response cap", () => {
  const output = ["Processing esp32 (platform: espressif32)", "===== [FAILED] Took 1.2 seconds =====", ...Array.from({ length: 55 }, (_, n) => `src/main.cpp:${n+1}:4: error: failure ${n}`), "RAM: [= ] 10.0% (used 10 bytes from 100 bytes)"].join("\n");
  const result = cleanCompatibilityResult({ exitCode: 0, output, logPath: "clean.log" }, undefined, 1.234);
  expect(result).toMatchObject({ ok: false, environments: ["esp32"], error_count: 55, duration_s: 1.23, memory: { ram: { percent: 10, used_bytes: 10, total_bytes: 100 } } });
  expect(result.errors).toHaveLength(50);
  expect(result.output_tail.split("\n")).toHaveLength(40);
});
