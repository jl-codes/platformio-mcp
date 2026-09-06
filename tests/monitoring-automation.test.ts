import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearAutomationMonitorState,
  getAutomationStatePath,
  listAutomationStates,
  readAutomationState,
  withAutomationStateLock,
  writeAutomationState,
} from "../src/core/automation-state.js";
import {
  compileBoundedPattern,
  decideMonitorNotification,
  evaluateMonitorHealth,
} from "../src/core/monitor-health.js";
import { readSerialWindowFromFile } from "../src/tools/monitor.js";

const createdDirectories: string[] = [];

function createProject(): string {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pio-automation-"));
  createdDirectories.push(projectDir);
  return projectDir;
}

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("monitoring automation primitives", () => {
  it("classifies failures, redacts evidence, and reports recovery", () => {
    const failed = evaluateMonitorHealth({
      serialOutput: "token=abc123 Guru Meditation",
      expectedMarkers: ["BOOT_OK"],
      rejectedPatterns: ["Guru Meditation"],
    });
    expect(failed.status).toBe("failed");
    expect(failed.evidence).not.toContain("abc123");
    expect(failed.consecutiveFailures).toBe(1);

    const recovered = evaluateMonitorHealth({
      serialOutput: "BOOT_OK",
      expectedMarkers: ["BOOT_OK"],
      previousDigest: failed.digest,
      previousStatus: failed.status,
      previousConsecutiveFailures: failed.consecutiveFailures,
    });
    expect(recovered.status).toBe("healthy");
    expect(recovered.recovered).toBe(true);
    expect(recovered.consecutiveFailures).toBe(0);
  });

  it("rejects unsafe opt-in regular expressions", () => {
    expect(() => compileBoundedPattern("re:(?=secret)secret")).toThrowError(
      /unsafe construct/i,
    );
  });

  it("debounces identical failures and emits one recovery", () => {
    const first = evaluateMonitorHealth({
      serialOutput: "Guru Meditation core 0",
      rejectedPatterns: ["Guru Meditation"],
    });
    expect(
      decideMonitorNotification({ automation: true, health: first }),
    ).toMatchObject({ shouldNotify: true, notificationReason: "failure" });

    const repeated = evaluateMonitorHealth({
      serialOutput: "Guru Meditation core 1",
      rejectedPatterns: ["Guru Meditation"],
      previousDigest: first.digest,
      previousStatus: first.status,
      previousConsecutiveFailures: first.consecutiveFailures,
    });
    expect(repeated.changed).toBe(false);
    expect(
      decideMonitorNotification({
        automation: true,
        health: repeated,
        previousDigest: first.digest,
      }),
    ).toEqual({ shouldNotify: false });

    const recovered = evaluateMonitorHealth({
      serialOutput: "BOOT_OK",
      expectedMarkers: ["BOOT_OK"],
      previousDigest: repeated.digest,
      previousStatus: repeated.status,
      previousConsecutiveFailures: repeated.consecutiveFailures,
    });
    expect(
      decideMonitorNotification({
        automation: true,
        health: recovered,
        previousDigest: repeated.digest,
      }),
    ).toMatchObject({ shouldNotify: true, notificationReason: "recovery" });
  });

  it("supports a bounded consecutive-failure threshold", () => {
    const first = evaluateMonitorHealth({
      serialOutput: "",
      expectedMarkers: ["BOOT_OK"],
    });
    expect(
      decideMonitorNotification({
        automation: true,
        health: first,
        failureThreshold: 2,
      }),
    ).toEqual({ shouldNotify: false });
    const second = evaluateMonitorHealth({
      serialOutput: "",
      expectedMarkers: ["BOOT_OK"],
      previousDigest: first.digest,
      previousStatus: first.status,
      previousConsecutiveFailures: first.consecutiveFailures,
    });
    expect(
      decideMonitorNotification({
        automation: true,
        health: second,
        previousDigest: first.digest,
        failureThreshold: 2,
      }),
    ).toMatchObject({ shouldNotify: true, notificationReason: "failure" });
  });

  it("persists only bounded change state and rejects overlapping runs", async () => {
    const projectDir = createProject();
    const initial = readAutomationState(projectDir, "serial-health");
    const written = writeAutomationState(projectDir, {
      ...initial,
      cursor: "cursor-1",
      digest: "digest-1",
      lastStatus: "healthy",
    });
    expect(readAutomationState(projectDir, "serial-health")).toMatchObject({
      cursor: "cursor-1",
      digest: "digest-1",
      lastStatus: "healthy",
    });
    expect(JSON.stringify(written)).not.toContain("serialOutput");

    let releaseFirst!: () => void;
    const first = withAutomationStateLock(
      projectDir,
      "serial-health",
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    await expect(
      withAutomationStateLock(
        projectDir,
        "serial-health",
        async () => undefined,
      ),
    ).rejects.toMatchObject({ code: "OVERLAPPING_RUN" });
    releaseFirst();
    await first;
  });

  it("clears monitoring state without resetting the hardware-write budget", async () => {
    const projectDir = createProject();
    const initial = readAutomationState(projectDir, "nightly-hil");
    writeAutomationState(projectDir, {
      ...initial,
      cursor: "cursor-before-reset",
      digest: "digest-before-reset",
      lastStatus: "failed",
      consecutiveFailures: 3,
      consecutiveHardwareWrites: 2,
      lastHardwareWriteAction: "upload_filesystem",
      lastHardwareWriteAt: new Date().toISOString(),
    });
    const statePath = getAutomationStatePath(projectDir, "nightly-hil");
    const stale = JSON.parse(fs.readFileSync(statePath, "utf8"));
    stale.updatedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(statePath, JSON.stringify(stale), "utf8");

    expect(listAutomationStates(projectDir)).toMatchObject([
      {
        automationKey: "nightly-hil",
        lastStatus: "failed",
        consecutiveFailures: 3,
        consecutiveHardwareWrites: 2,
      },
    ]);

    const reset = await clearAutomationMonitorState(projectDir, "nightly-hil");
    expect(reset).toMatchObject({
      automationKey: "nightly-hil",
      consecutiveFailures: 0,
      consecutiveHardwareWrites: 2,
      lastHardwareWriteAction: "upload_filesystem",
    });
    expect(reset.cursor).toBeUndefined();
    expect(reset.digest).toBeUndefined();
    expect(reset.lastStatus).toBeUndefined();
  });

  it("reads serial logs incrementally with byte bounds and opaque cursors", () => {
    const projectDir = createProject();
    const logPath = path.join(projectDir, "monitor.log");
    fs.writeFileSync(logPath, "BOOT_OK\n", "utf8");
    const initial = readSerialWindowFromFile(logPath);
    fs.appendFileSync(
      logPath,
      `password=supersecret\n${"x".repeat(400)}`,
      "utf8",
    );
    const next = readSerialWindowFromFile(logPath, {
      cursor: initial.cursor,
      maxBytes: 256,
    });
    expect(next.content).not.toContain("supersecret");
    expect(next.bytes).toBeLessThanOrEqual(256);
    expect(next.truncated).toBe(true);
    expect(() =>
      readSerialWindowFromFile(logPath, { cursor: "not-a-cursor" }),
    ).toThrowError(/cursor/i);
  });
});
