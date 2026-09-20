/** Test compatibility retains canonical high-risk permission and truthful per-case results. */
import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), run: vi.fn(), lock: vi.fn() }));
vi.mock("../src/core/action-dispatcher.js", () => ({ dispatchAuthorizedAction: mocks.dispatch }));
vi.mock("../src/core/test-report-execution.js", () => ({ runTestsWithReport: mocks.run }));
vi.mock("../src/utils/lock-manager.js", () => ({ hardwareLockManager: { withImplicitLock: mocks.lock } }));
vi.mock("../src/core/policy/revision-guard.js", () => ({ createPolicyRevisionGuard: () => () => {} }));
vi.mock("../src/adapters/compatibility-project.js", () => ({ resolveCompatibilityProject: async () => "workspace" }));
vi.mock("../src/utils/command-log.js", () => ({ readCommandOutput: async () => "test output", retainCommandLog: async () => "test.log" }));
import { executeTestCompatibility } from "../src/adapters/test-compat.js";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatch.mockImplementation((_name, _args, _caller, callback) => callback());
  mocks.lock.mockImplementation(callback => callback());
});

test("test permission denial prevents execution even when upload is skipped", async () => {
  mocks.dispatch.mockRejectedValueOnce(new Error("denied"));
  await expect(executeTestCompatibility({ without_uploading: true, upload_port: "COM8" })).rejects.toThrow("denied");
  expect(mocks.dispatch.mock.calls[0][0]).toBe("run_tests");
  expect(mocks.dispatch.mock.calls[0][1]).toMatchObject({ withoutUploading: true, uploadPort: "COM8" });
  expect(mocks.run).not.toHaveBeenCalled();
});

test("warned cases remain distinct from passed cases", async () => {
  mocks.run.mockImplementationOnce(async (_project, _env, _compile, options) => {
    expect(options).toMatchObject({ filter: "test_*", withoutUploading: false, timeoutMs: 1200000 });
    await options.onResult({ exitCode: 0, fullLogPath: "raw.log" });
    return { success: true, testReport: { total: 1, failed: 0, errored: 0, skipped: 0, warned: 1, duration_s: 0, suites: [] } };
  });
  const result = await executeTestCompatibility({ filter: "test_*" });
  expect(result.summary).toContain("0 passed");
  expect(result.summary).toContain("1 warned");
  expect(mocks.lock).toHaveBeenCalledOnce();
});

test("invalid report does not become a passing run", async () => {
  mocks.run.mockImplementationOnce(async (_project, _env, _compile, options) => {
    await options.onResult({ exitCode: 0, fullLogPath: "raw.log" });
    return { success: false, testReportError: "TEST_REPORT_INVALID" };
  });
  await expect(executeTestCompatibility({})).resolves.toMatchObject({ ok: false, status: "error", report_error: "TEST_REPORT_INVALID" });
});


test("confirmed test timeout retains diagnostics without inventing case results", async () => {
  const { PlatformIOError } = await import("../src/utils/errors.js");
  mocks.run.mockRejectedValueOnce(new PlatformIOError("timeout", "COMMAND_TIMEOUT", { cleanupPending: false, fullLogPath: "raw.log" }));
  const result = await executeTestCompatibility({});
  expect(result).toMatchObject({ ok: false, status: "error", error: "test_timeout", exit_code: -1, log_path: "test.log" });
  expect(result.output_tail).toContain("timed out after 1200s");
  expect(result).not.toHaveProperty("total");
});

test("uncertain shutdown propagates its custody error unchanged", async () => {
  const { PlatformIOError } = await import("../src/utils/errors.js");
  const error = new PlatformIOError("pending", "PROCESS_CLEANUP_PENDING", { cleanupPending: true });
  mocks.run.mockRejectedValueOnce(error);
  await expect(executeTestCompatibility({})).rejects.toBe(error);
});
