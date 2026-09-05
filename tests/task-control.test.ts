import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cancelTaskCore,
  listTaskHistoryCore,
} from "../src/core/tasks.js";
import { registerCommand } from "../src/utils/command-registry.js";

const createdDirectories: string[] = [];

function createProject(): string {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pio-task-control-"));
  createdDirectories.push(projectDir);
  return projectDir;
}

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("task control", () => {
  it("returns compact, project-scoped task history", async () => {
    const projectDir = createProject();
    await registerCommand(
      {
        id: "command-1",
        commandDesc: "pio run",
        timestamp: Date.now(),
        status: "success",
        tasks: [
          {
            taskId: "task-1",
            type: "build",
            status: "success",
            logPaths: [path.join(projectDir, "build.log")],
            exitCode: 0,
          },
        ],
      },
      projectDir,
    );
    const result = await listTaskHistoryCore({ projectDir, limit: 5 });
    expect(result.tasks).toEqual([
      expect.objectContaining({
        commandId: "command-1",
        taskId: "task-1",
        status: "success",
        type: "build",
      }),
    ]);
  });

  it("treats repeated cancellation of a terminal task as success", async () => {
    const projectDir = createProject();
    await registerCommand(
      {
        id: "command-2",
        commandDesc: "pio test",
        timestamp: Date.now(),
        status: "terminated",
        tasks: [
          { taskId: "task-2", type: "test", status: "terminated" },
        ],
      },
      projectDir,
    );
    await expect(
      cancelTaskCore({ taskId: "task-2", projectDir }),
    ).resolves.toMatchObject({
      success: true,
      status: "already_terminal",
      processTerminated: false,
    });
  });
});
