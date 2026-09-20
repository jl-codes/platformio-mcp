/** Capture orchestration preserves stop semantics and private files until process closure is known. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  target: vi.fn(),
  retain: vi.fn(),
  directory: vi.fn(),
}));
vi.mock("../src/tools/build.js", () => ({ buildTarget: mocks.target }));
vi.mock("../src/core/analysis/upload-capture-record.js", () => ({
  retainUploadCapture: mocks.retain,
}));
vi.mock("../src/core/analysis/private-analysis-directory.js", () => ({
  createPrivateAnalysisDirectory: mocks.directory,
}));
import {
  captureTargetUpload,
  type CaptureTargetUploadInput,
} from "../src/core/analysis/capture-target-upload.js";
import { uploadCaptureEnvironment } from "../src/core/analysis/upload-capture-environment.js";
import { PlatformIOError } from "../src/utils/errors.js";
let root: string, input: CaptureTargetUploadInput;
beforeEach(async () => {
  vi.resetAllMocks();
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pio-capture-target-")),
  );
  mocks.directory.mockResolvedValue(root);
  mocks.retain.mockResolvedValue({ sha256: "retained" });
  input = {
    context: {
      projectDir: root,
      environment: "esp32",
      compiler: "compiler",
      toolchain: { id: "compiler", version: "fixture" },
      uploader: {
        pythonPath: process.execPath,
        esptoolPath: path.join(root, "esptool.py"),
        chip: "esp32",
        port: "COM7",
      },
    },
    execution: { uploadPort: "COM7", serialPort: "COM7" },
  };
  vi.stubEnv("PLATFORMIO_EXTRA_SCRIPTS", "pre:existing.py\npost:finish.py");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
it("retains only after the completed target stops, preserving inherited extra scripts", async () => {
  mocks.target.mockImplementation(
    async (_project, _target, _environment, _verbose, options) => {
      expect(options.captureEnvironment.PLATFORMIO_EXTRA_SCRIPTS).toBe(
        `pre:existing.py\npost:finish.py\npost:${path.join(root, "capture.py")}\n`,
      );
      expect(
        await fs.readFile(path.join(root, "capture.py"), "utf8"),
      ).toContain("return 86");
      expect(mocks.retain).not.toHaveBeenCalled();
      await options.onResult({ exitCode: 1 });
      return { success: false };
    },
  );
  expect(await captureTargetUpload(input)).toEqual({ sha256: "retained" });
  expect(mocks.retain).toHaveBeenCalledWith(
    path.join(root, "selection.json"),
    expect.objectContaining({ captureDirectory: root }),
    undefined,
  );
  await expect(fs.stat(root)).rejects.toMatchObject({ code: "ENOENT" });
  expect(process.env.PLATFORMIO_EXTRA_SCRIPTS).toBe(
    "pre:existing.py\npost:finish.py",
  );
});
it("rejects a normal successful upload instead of treating it as a captured stop", async () => {
  mocks.target.mockImplementation(async (_p, _t, _e, _v, options) => {
    await options.onResult({ exitCode: 0 });
    return { success: true };
  });
  await expect(captureTargetUpload(input)).rejects.toMatchObject({
    code: "UPLOAD_CAPTURE_FAILED",
  });
  expect(mocks.retain).not.toHaveBeenCalled();
});
it("retains the hook if child termination cannot be confirmed", async () => {
  mocks.target.mockRejectedValue(
    new PlatformIOError("still running", "PROCESS_CLEANUP_PENDING", {
      cleanupPending: true,
    }),
  );
  await expect(captureTargetUpload(input)).rejects.toMatchObject({
    code: "PROCESS_CLEANUP_PENDING",
  });
  expect((await fs.stat(path.join(root, "capture.py"))).isFile()).toBe(true);
  expect(mocks.retain).not.toHaveBeenCalled();
});
it("preserves legacy inherited scripts and rejects ambiguous list reinterpretation", () => {
  const script = path.join(root, "capture.py");
  expect(
    uploadCaptureEnvironment(script, {
      PLATFORMIO_EXTRA_SCRIPT: "pre:legacy.py",
    }).PLATFORMIO_EXTRA_SCRIPTS,
  ).toBe(`pre:legacy.py\npost:${script}\n`);
  expect(() =>
    uploadCaptureEnvironment(script, {
      PLATFORMIO_EXTRA_SCRIPTS: "pre:a.py, post:b.py",
    }),
  ).toThrow("interpretation");
});
