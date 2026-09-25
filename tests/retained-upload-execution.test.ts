/** Retained uploader execution rechecks bytes and preserves the real cleanup owner on uncertainty. */
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  wait: vi.fn(),
  cleanup: vi.fn(),
  validate: vi.fn(),
}));
vi.mock("../src/core/debug/debug-backend-process.js", () => ({
  DebugBackendProcess: class {
    constructor(options: unknown) {
      mocks.launch(options);
    }
    waitForCompletion(...args: unknown[]) {
      return mocks.wait(...args);
    }
    cleanupProcess() {
      return mocks.cleanup();
    }
  },
}));
vi.mock("../src/core/analysis/esptool-upload-command.js", () => ({
  validateEspUploadCommand: mocks.validate,
}));
import {
  executeRetainedEspUpload,
  UploadCleanupFailure,
} from "../src/core/analysis/retained-upload-execution.js";
import type { retainUploadCapture } from "../src/core/analysis/upload-capture-record.js";
const context = {
  pythonPath: "host-python",
  esptoolPath: "host-esptool",
  chip: "esp32",
  port: "COM7",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.wait.mockResolvedValue(0);
  mocks.cleanup.mockResolvedValue(undefined);
  mocks.validate.mockResolvedValue(undefined);
});
function fixture() {
  const verify = vi.fn().mockResolvedValue(undefined);
  const retained = {
    arguments: [
      context.pythonPath,
      context.esptoolPath,
      "write_flash",
      "0x10000",
      "retained.bin",
    ],
    manifest: { projectDir: "project" },
    sha256: "manifest hash",
    verify,
  } as unknown as Awaited<ReturnType<typeof retainUploadCapture>>;
  const custody = { prepareSpawn: vi.fn(), releaseAfterExit: vi.fn() };
  const guard = vi.fn();
  return { retained, verify, custody, guard };
}
it("launches the retained command after preparation and a second byte check", async () => {
  const { retained, verify, custody, guard } = fixture();
  mocks.launch.mockImplementation(() => {
    expect(verify).toHaveBeenCalledTimes(2);
    expect(custody.prepareSpawn).toHaveBeenCalledOnce();
    expect(custody.releaseAfterExit).not.toHaveBeenCalled();
  });
  await expect(
    executeRetainedEspUpload(retained, context, { custody, guard }),
  ).resolves.toMatchObject({ exitCode: 0, manifestSha256: "manifest hash" });
  expect(mocks.launch).toHaveBeenCalledWith(
    expect.objectContaining({
      command: {
        executable: context.pythonPath,
        arguments: retained.arguments.slice(1),
        cwd: "project",
      },
    }),
  );
  expect(custody.releaseAfterExit).toHaveBeenCalledOnce();
});
it("does not spawn if the retained bytes change during device preparation", async () => {
  const { retained, verify, custody, guard } = fixture();
  verify
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("changed bytes"));
  await expect(
    executeRetainedEspUpload(retained, context, { custody, guard }),
  ).rejects.toThrow("changed bytes");
  expect(mocks.launch).not.toHaveBeenCalled();
  expect(custody.releaseAfterExit).toHaveBeenCalledOnce();
});
it("retains a callable cleanup owner and releases only after a successful retry", async () => {
  const { retained, custody, guard } = fixture();
  mocks.cleanup.mockRejectedValueOnce(new Error("unknown descendants"));
  const failure = await executeRetainedEspUpload(retained, context, {
    custody,
    guard,
  }).catch((error) => error);
  expect(failure).toBeInstanceOf(UploadCleanupFailure);
  expect(custody.releaseAfterExit).not.toHaveBeenCalled();
  await failure.cleanupProcess();
  expect(custody.releaseAfterExit).toHaveBeenCalledOnce();
});
it("does not spawn on cancellation before execution", async () => {
  const { retained, custody, guard } = fixture();
  const abort = new AbortController();
  abort.abort();
  await expect(
    executeRetainedEspUpload(retained, context, {
      custody,
      guard,
      signal: abort.signal,
    }),
  ).rejects.toMatchObject({ code: "PROCESS_CANCELLED" });
  expect(mocks.launch).not.toHaveBeenCalled();
});
