/** Verifies that failed process cleanup never makes task cancellation terminal. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformIOError } from "../src/utils/errors.js";
import { cancelTaskCore } from "../src/core/tasks.js";
import {
  getCommandHistory,
  registerCommand,
} from "../src/utils/command-registry.js";

const cleanup = vi.hoisted(() => ({
  stopMonitor: vi.fn(),
  killTrackedTaskProcess: vi.fn(),
}));
vi.mock("../src/tools/monitor.js", () => ({
  stopMonitor: cleanup.stopMonitor,
}));
vi.mock("../src/utils/process-manager.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/process-manager.js")>()),
  killTrackedTaskProcess: cleanup.killTrackedTaskProcess,
}));

let projectDir: string;
beforeEach(() => {
  vi.resetAllMocks();
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pio-cancel-safety-"));
});
afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

/** Register one live task without starting a real process or touching hardware. */
async function registerRunningTask(type: "monitor" | "build") {
  await registerCommand(
    {
      id: "command",
      commandDesc: "test operation",
      timestamp: Date.now(),
      status: "running",
      tasks: [
        {
          taskId: "task",
          type,
          status: "running",
          pid: process.pid,
          ...(type === "monitor" ? { port: "COM75" } : {}),
        },
      ],
    },
    projectDir,
  );
}

describe("cancellation cleanup safety", () => {
  it("keeps an unverified monitor running and retryable", async () => {
    await registerRunningTask("monitor");
    cleanup.stopMonitor.mockRejectedValueOnce(
      new PlatformIOError(
        "Monitor identity cannot be verified.",
        "PROCESS_IDENTITY_UNVERIFIED",
      ),
    );
    await expect(
      cancelTaskCore({ taskId: "task", projectDir }),
    ).rejects.toMatchObject({
      code: "PROCESS_IDENTITY_UNVERIFIED",
    });
    expect(getCommandHistory(projectDir)[0].tasks[0].status).toBe("running");

    cleanup.stopMonitor.mockResolvedValueOnce(undefined);
    await expect(
      cancelTaskCore({ taskId: "task", projectDir }),
    ).resolves.toMatchObject({
      success: true,
      status: "cancelled",
    });
    expect(cleanup.stopMonitor).toHaveBeenCalledTimes(2);
    expect(getCommandHistory(projectDir)[0].tasks[0].status).toBe("terminated");
  });

  it("keeps a refused build cancellation running", async () => {
    await registerRunningTask("build");
    cleanup.killTrackedTaskProcess.mockRejectedValueOnce(
      new PlatformIOError(
        "Process is not owned by this task.",
        "PROCESS_IDENTITY_UNVERIFIED",
      ),
    );
    await expect(
      cancelTaskCore({ taskId: "task", projectDir }),
    ).rejects.toThrow("Process is not owned by this task.");
    expect(getCommandHistory(projectDir)[0].status).toBe("running");
    expect(getCommandHistory(projectDir)[0].tasks[0].status).toBe("running");
  });
});
