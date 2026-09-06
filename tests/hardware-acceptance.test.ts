import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveHardwareProject,
  runHardwareAcceptance,
} from "../scripts/run-hardware-acceptance.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createRepoFixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pio-hil-plan-"));
  temporaryDirectories.push(repoRoot);
  const projectDir = path.join(repoRoot, "fixtures", "board");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "platformio.ini"),
    "[env:test]\nboard = test\n",
  );
  return { repoRoot, projectDir };
}

function createConfig() {
  const { repoRoot, projectDir } = createRepoFixture();
  return {
    repoRoot,
    projectDir,
    projectLabel: "fixtures/board",
    environment: "test",
    port: "/dev/ttyUSB0",
    expectedMarker: "BOOT_OK",
    boardFamily: "fixture",
    captureDurationSeconds: 5,
  };
}

describe("physical hardware acceptance orchestration", () => {
  it("keeps the selected fixture inside the checkout", () => {
    const { repoRoot, projectDir } = createRepoFixture();
    expect(resolveHardwareProject(repoRoot, "fixtures/board")).toBe(projectDir);
    expect(() => resolveHardwareProject(repoRoot, "../outside")).toThrow(
      "must stay inside",
    );
    expect(() => resolveHardwareProject(repoRoot, projectDir)).toThrow(
      "checkout-relative",
    );
  });

  it("builds, explicitly flashes, reattaches by identity, and proves cleanup", async () => {
    const config = createConfig();
    let targetCall = 0;
    const runCommand = vi.fn((args: string[]) => {
      switch (args[0]) {
        case "target-resolve":
          targetCall += 1;
          return {
            success: true,
            port: targetCall === 1 ? "/dev/ttyUSB0" : "/dev/ttyUSB1",
            binding: {
              digest: "a".repeat(64),
              deviceFingerprint: "b".repeat(64),
            },
          };
        case "build":
          return { success: true, taskId: "build-1" };
        case "flash":
          expect(args).toContain("--approve");
          expect(args).toContain("/dev/ttyUSB0");
          return { success: true, taskId: "flash-1" };
        case "monitor-health":
          expect(args).not.toContain("/dev/ttyUSB0");
          return {
            success: true,
            health: { status: "healthy", digest: "c".repeat(64) },
          };
        case "task-history":
          return { tasks: [{ status: "success" }] };
        default:
          throw new Error(`Unexpected command: ${args[0]}`);
      }
    });

    const report = await runHardwareAcceptance(config, runCommand);

    expect(report).toMatchObject({
      success: true,
      boardFamily: "fixture",
      project: "fixtures/board",
      environment: "test",
      portReenumerated: true,
      cleanup: { runningTasks: 0 },
    });
    expect(runCommand).toHaveBeenCalledTimes(6);
  });

  it("stops before monitoring when the physical identity changes", async () => {
    const config = createConfig();
    let targetCall = 0;
    const runCommand = vi.fn((args: string[]) => {
      if (args[0] === "target-resolve") {
        targetCall += 1;
        return {
          success: true,
          port: `/dev/ttyUSB${targetCall - 1}`,
          binding: {
            digest: "a".repeat(64),
            deviceFingerprint: (targetCall === 1 ? "b" : "c").repeat(64),
          },
        };
      }
      if (args[0] === "build" || args[0] === "flash") {
        return { success: true };
      }
      throw new Error(`Unexpected command: ${args[0]}`);
    });

    await expect(runHardwareAcceptance(config, runCommand)).rejects.toThrow(
      "device identity changed",
    );
    expect(
      runCommand.mock.calls.some(([args]) => args[0] === "monitor-health"),
    ).toBe(false);
  });

  it("retries a temporarily unavailable port after USB re-enumeration", async () => {
    const config = createConfig();
    let targetCall = 0;
    const delay = vi.fn(async () => undefined);
    const runCommand = vi.fn((args: string[]) => {
      if (args[0] === "target-resolve") {
        targetCall += 1;
        if (targetCall === 2) {
          return { success: false, status: "unavailable", summary: "waiting" };
        }
        return {
          success: true,
          port: targetCall === 1 ? "/dev/ttyUSB0" : "/dev/ttyUSB1",
          binding: {
            digest: "a".repeat(64),
            deviceFingerprint: "b".repeat(64),
          },
        };
      }
      if (args[0] === "build" || args[0] === "flash") {
        return { success: true };
      }
      if (args[0] === "monitor-health") {
        return { success: true, health: { status: "healthy" } };
      }
      if (args[0] === "task-history") return { tasks: [] };
      throw new Error(`Unexpected command: ${args[0]}`);
    });

    const report = await runHardwareAcceptance(config, runCommand, delay);
    expect(report).toMatchObject({ success: true, reattachAttempts: 2 });
    expect(delay).toHaveBeenCalledWith(1000);
  });
});
