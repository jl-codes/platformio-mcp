/** Spooling failures release local log resources while retaining uncertain hardware custody. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  wait: vi.fn(),
  spawn: vi.fn(async () => ({})),
  register: vi.fn(),
  release: vi.fn(),
  unregister: vi.fn(),
  close: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: { spawn: mocks.spawn },
}));
vi.mock("../src/utils/owned-process-wait.js", () => ({
  waitForOwnedProcess: mocks.wait,
}));
vi.mock("../src/utils/semaphore.js", () => ({
  portSemaphoreManager: { releasePort: mocks.release },
}));
vi.mock("../src/utils/process-manager.js", () => ({
  isBuildActive: () => false,
  registerBuildPid: mocks.register,
  unregisterBuildPid: mocks.unregister,
}));
vi.mock("../src/utils/command-registry.js", () => ({
  registerCommand: vi.fn(),
  updateTaskStatus: mocks.update,
}));
import { executeWithSpooling } from "../src/utils/spooler.js";
import { PlatformIOError } from "../src/utils/errors.js";
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
it.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])(
  "cleans failure with background=%s cleanupPending=%s",
  async (background, cleanupPending) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-spool-custody-"));
    roots.push(root);
    mocks.update.mockResolvedValue(undefined);
    mocks.unregister.mockResolvedValue(undefined);
    const watcher = { on: vi.fn(), close: mocks.close };
    vi.spyOn(fs, "watch").mockReturnValue(watcher as unknown as fs.FSWatcher);
    const closeFd = vi.spyOn(fs, "closeSync");
    const error = new PlatformIOError("fixture timeout", "COMMAND_TIMEOUT", {
      cleanupPending,
    });
    mocks.wait.mockRejectedValue(error);
    const operation = executeWithSpooling("run", [], {
      cwd: root,
      activePort: "COM99",
      background,
    });
    if (background) {
      expect(await operation).toMatchObject({ status: "running" });
      await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
    } else
      await expect(operation).rejects.toMatchObject({
        code: "COMMAND_TIMEOUT",
        context: { cleanupPending, fullLogPath: expect.any(String) },
      });
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(closeFd).toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledTimes(cleanupPending ? 0 : 1);
    expect(mocks.unregister).toHaveBeenCalledTimes(cleanupPending ? 0 : 1);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ status: "error" }),
      root,
    );
  },
);

it("closes its output descriptor when spawning fails before a child exists", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-spool-start-"));
  roots.push(root);
  const opened = vi.spyOn(fs, "openSync");
  const closed = vi.spyOn(fs, "closeSync");
  mocks.spawn.mockRejectedValueOnce(new Error("fixture spawn failure"));
  await expect(
    executeWithSpooling("run", [], { cwd: root, activePort: "COM99" }),
  ).rejects.toMatchObject({
    code: "PROCESS_START_FAILED",
    context: { cleanupPending: false },
  });
  expect(closed).toHaveBeenCalledWith(opened.mock.results[0].value);
  expect(mocks.wait).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledWith("COM99");
});

it.each([false, true])(
  "bounds registration failure cleanup, retaining uncertain custody=%s",
  async (cleanupPending) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-spool-register-"));
    roots.push(root);
    const opened = vi.spyOn(fs, "openSync");
    const closed = vi.spyOn(fs, "closeSync");
    mocks.spawn.mockResolvedValueOnce({ pid: 42 });
    mocks.wait.mockImplementationOnce(
      (_proc, _timeout, _grace, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () =>
              reject(
                new PlatformIOError("fixture cancelled", "PROCESS_CANCELLED", {
                  cleanupPending,
                }),
              ),
            { once: true },
          ),
        ),
    );
    mocks.register.mockImplementationOnce(async () => {
      expect(mocks.wait).toHaveBeenCalledOnce();
      throw new Error("fixture registry failure");
    });
    await expect(
      executeWithSpooling("run", [], {
        cwd: root,
        activePort: "COM99",
        background: true,
      }),
    ).rejects.toMatchObject({
      code: "PROCESS_REGISTRATION_FAILED",
      context: { cleanupPending, pid: 42 },
    });
    expect(closed).toHaveBeenCalledWith(opened.mock.results[0].value);
    expect(mocks.release).toHaveBeenCalledTimes(cleanupPending ? 0 : 1);
    expect(mocks.unregister).toHaveBeenCalledTimes(cleanupPending ? 0 : 1);
  },
);
