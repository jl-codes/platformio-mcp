/** Approval retries use the original captured firmware and cannot replay or cross connection boundaries. */
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../src/core/action-dispatcher.js", () => ({
  dispatchAuthorizedAction: mocks.dispatch,
}));
import { PendingUploadStore } from "../src/core/analysis/pending-upload-store.js";
import type { retainUploadCapture } from "../src/core/analysis/upload-capture-record.js";
import { PlatformIOError } from "../src/utils/errors.js";
const scope = {
  projectDir: "project",
  environment: "esp32",
  uploadPort: "COM7",
};
function fixture() {
  const verify = vi.fn().mockResolvedValue(undefined);
  const retained = {
    manifest: { projectDir: scope.projectDir, environment: scope.environment },
    sha256: "a".repeat(64),
    verify,
  } as unknown as Awaited<ReturnType<typeof retainUploadCapture>>;
  return { retained, verify };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.dispatch.mockImplementation(async (_name, _args, _caller, run) =>
    run(),
  );
});
it("preserves a denied capture for approval without rebuilding and consumes it exactly once", async () => {
  const { retained, verify } = fixture();
  const store = new PendingUploadStore<string>();
  const execute = vi.fn().mockResolvedValue("flashed");
  const staged = store.stage(retained, scope, () => {}, execute);
  mocks.dispatch.mockRejectedValueOnce(
    new PlatformIOError("approve", "APPROVAL_REQUIRED"),
  );
  await expect(
    store.resume(staged.resumeId, scope, undefined, {}),
  ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  expect(execute).not.toHaveBeenCalled();
  expect(verify).not.toHaveBeenCalled();
  await expect(
    store.resume(staged.resumeId, scope, "approval", {}),
  ).resolves.toBe("flashed");
  expect(mocks.dispatch).toHaveBeenLastCalledWith(
    "upload_firmware",
    expect.objectContaining({
      manifestSha256: retained.sha256,
      resumeId: staged.resumeId,
      approvalId: "approval",
      uploadPort: "COM7",
    }),
    expect.anything(),
    expect.any(Function),
  );
  expect(verify).toHaveBeenCalledOnce();
  await expect(
    store.resume(staged.resumeId, scope, "approval", {}),
  ).rejects.toMatchObject({ code: "UPLOAD_RESUME_UNAVAILABLE" });
});
it("rejects another destination or connection before authorization", async () => {
  const { retained } = fixture();
  const store = new PendingUploadStore();
  const { resumeId } = store.stage(retained, scope, () => {}, vi.fn());
  await expect(
    store.resume(resumeId, { ...scope, uploadPort: "COM8" }, undefined, {}),
  ).rejects.toThrow();
  await expect(
    new PendingUploadStore().resume(resumeId, scope, undefined, {}),
  ).rejects.toThrow();
  expect(mocks.dispatch).not.toHaveBeenCalled();
});
it("expires pending firmware and cancels execution on disconnect", async () => {
  const { retained } = fixture();
  let now = 0;
  const expired = new PendingUploadStore(() => now);
  const old = expired.stage(retained, scope, () => {}, vi.fn());
  now = 15 * 60 * 1000;
  await expect(
    expired.resume(old.resumeId, scope, undefined, {}),
  ).rejects.toThrow();
  const store = new PendingUploadStore<string>();
  let signal!: AbortSignal;
  let finish!: (value: string) => void;
  const execute = vi.fn((owned: AbortSignal) => {
    signal = owned;
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  });
  const { resumeId } = store.stage(retained, scope, () => {}, execute);
  const running = store.resume(resumeId, scope, undefined, {});
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
  await expect(store.resume(resumeId, scope, undefined, {})).rejects.toThrow();
  store.close();
  expect(signal.aborted).toBe(true);
  finish("closed");
  await running;
});
it("never launches retained bytes that failed revalidation", async () => {
  const { retained, verify } = fixture();
  verify.mockRejectedValue(new Error("tampered"));
  const store = new PendingUploadStore();
  const execute = vi.fn();
  const { resumeId } = store.stage(retained, scope, () => {}, execute);
  await expect(store.resume(resumeId, scope, undefined, {})).rejects.toThrow(
    "tampered",
  );
  expect(execute).not.toHaveBeenCalled();
  await expect(store.resume(resumeId, scope, undefined, {})).rejects.toThrow(
    "missing",
  );
});

it("keeps failed upload cleanup available across disconnect retries", async () => {
  const { UploadCleanupFailure } =
    await import("../src/core/analysis/retained-upload-execution.js");
  const { retained } = fixture();
  const cleanup = vi
    .fn()
    .mockRejectedValueOnce(new Error("still owned"))
    .mockResolvedValue(undefined);
  const failure = new UploadCleanupFailure(cleanup);
  const store = new PendingUploadStore();
  const { resumeId } = store.stage(
    retained,
    scope,
    () => {},
    async () => {
      throw failure;
    },
  );
  await expect(store.resume(resumeId, scope, undefined, {})).rejects.toBe(
    failure,
  );
  await expect(store.close()).rejects.toThrow("still owned");
  await store.close();
  expect(cleanup).toHaveBeenCalledTimes(2);
});
