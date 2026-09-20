/** Named targets retain exact argv, complete logs and process-custody errors. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildTarget } from "../src/tools/build.js";
import { executeWithSpooling } from "../src/utils/spooler.js";
import { PlatformIOError } from "../src/utils/errors.js";
vi.mock("../src/utils/spooler.js", () => ({ executeWithSpooling: vi.fn() }));
let project: string;
beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "pio-target-"));
  fs.writeFileSync(
    path.join(project, "platformio.ini"),
    "[env:fixture]\nplatform=native\n",
  );
  vi.mocked(executeWithSpooling).mockReset();
  vi.mocked(executeWithSpooling).mockResolvedValue({
    exitCode: 0,
    finalOutput: "ok",
    fullLogPath: path.join(project, "result.log"),
  });
});
afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

it("preserves default target invocation and return behavior", async () => {
  expect(await buildTarget(project, "buildfs")).toMatchObject({
    success: true,
    environment: "default",
    output: undefined,
  });
  expect(executeWithSpooling).toHaveBeenCalledWith(
    "run",
    ["--target", "buildfs"],
    expect.objectContaining({ timeout: 600000 }),
  );
});

it("forwards explicit selection and observes completed failed output", async () => {
  const completed = {
    exitCode: 1,
    finalOutput: "error: upload failed",
    fullLogPath: "fixture.log",
  };
  vi.mocked(executeWithSpooling).mockResolvedValue(completed);
  const onResult = vi.fn().mockResolvedValue(undefined);
  expect(
    await buildTarget(project, "uploadfs", "fixture", true, {
      uploadPort: "board.local",
      timeoutMs: 1200000,
      onResult,
    }),
  ).toMatchObject({ success: false, output: completed.finalOutput });
  expect(executeWithSpooling).toHaveBeenCalledWith(
    "run",
    [
      "--target",
      "uploadfs",
      "--environment",
      "fixture",
      "--upload-port",
      "board.local",
      "--verbose",
    ],
    expect.objectContaining({ timeout: 1200000 }),
  );
  expect(onResult).toHaveBeenCalledExactlyOnceWith(completed);
});

it.each(["", "--upload", "build\n--target upload"])(
  "rejects invalid target %j before execution",
  async (target) => {
    await expect(buildTarget(project, target)).rejects.toThrow(
      "Invalid named target",
    );
    expect(executeWithSpooling).not.toHaveBeenCalled();
  },
);

it.each([{ timeoutMs: 0 }, { timeoutMs: 3600001 }, { uploadPort: "COM1\n" }])(
  "rejects malformed execution controls %j",
  async (options) => {
    await expect(
      buildTarget(project, "upload", undefined, false, options),
    ).rejects.toThrow();
    expect(executeWithSpooling).not.toHaveBeenCalled();
  },
);

it("preserves uncertain custody instead of converting it to a plain build failure", async () => {
  const failure = new PlatformIOError(
    "termination unconfirmed",
    "PROCESS_CLEANUP_PENDING",
    {
      cleanupPending: true,
      fullLogPath: "fixture.log",
    },
  );
  vi.mocked(executeWithSpooling).mockRejectedValue(failure);
  await expect(buildTarget(project, "upload")).rejects.toBe(failure);
});
