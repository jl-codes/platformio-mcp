import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/core/boards.js", () => ({
  listBoardsCore: vi.fn(async (filter?: string) => {
    if (filter === "esp32dev") {
      return [
        {
          id: "esp32dev",
          name: "Espressif ESP32 Dev Module",
          platform: "espressif32",
          mcu: "ESP32",
          frameworks: ["arduino"],
        },
      ];
    }
    return [];
  }),
}));

vi.mock("../src/core/devices.js", () => ({
  listDevicesCore: vi.fn(async () => []),
}));

vi.mock("../src/tools/projects.js", () => ({
  getProjectConfig: vi.fn(async () => ({ environments: ["esp32dev"] })),
}));

vi.mock("../src/core/build.js", () => ({
  buildProjectCore: vi.fn(),
}));

vi.mock("../src/core/flash.js", () => ({
  uploadFirmwareCore: vi.fn(),
}));

vi.mock("../src/utils/build-cache.js", () => ({
  findFirmwareArtifact: vi.fn(() => undefined),
}));

import {
  agentBuildDiagnose,
  agentFlashMonitorVerify,
  agentGetLastReport,
  agentValidateProject,
} from "../src/tools/agent.js";
import { listBoardsCore } from "../src/core/boards.js";
import { listDevicesCore } from "../src/core/devices.js";
import { buildProjectCore } from "../src/core/build.js";
import { uploadFirmwareCore } from "../src/core/flash.js";
import { findFirmwareArtifact } from "../src/utils/build-cache.js";
import { readLastAgentReport } from "../src/utils/artifacts.js";

const mockedListBoardsCore = vi.mocked(listBoardsCore);
const mockedListDevicesCore = vi.mocked(listDevicesCore);
const mockedBuildProjectCore = vi.mocked(buildProjectCore);
const mockedUploadFirmwareCore = vi.mocked(uploadFirmwareCore);
const mockedFindFirmwareArtifact = vi.mocked(findFirmwareArtifact);

const createdDirs: string[] = [];

function createTempProject(): string {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pio-agent-workflow-"));
  createdDirs.push(projectDir);
  return projectDir;
}

function writeProjectFiles(projectDir: string, ini: string, source: string): void {
  fs.writeFileSync(path.join(projectDir, "platformio.ini"), ini, "utf8");
  fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "src", "main.cpp"), source, "utf8");
}

describe("agent workflow integration", () => {
  beforeEach(() => {
    mockedListBoardsCore.mockReset();
    mockedListDevicesCore.mockReset();
    mockedBuildProjectCore.mockReset();
    mockedUploadFirmwareCore.mockReset();
    mockedFindFirmwareArtifact.mockReset();

    mockedListBoardsCore.mockImplementation(async (filter?: string) => {
      if (filter === "esp32dev") {
        return [
          {
            id: "esp32dev",
            name: "Espressif ESP32 Dev Module",
            platform: "espressif32",
            mcu: "ESP32",
            frameworks: ["arduino"],
          },
        ];
      }
      return [];
    });
    mockedListDevicesCore.mockResolvedValue([]);
    mockedFindFirmwareArtifact.mockReturnValue(undefined);
  });

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("validates project readiness and persists report", async () => {
    const projectDir = createTempProject();
    writeProjectFiles(
      projectDir,
      [
        "[env:esp32dev]",
        "platform = espressif32",
        "board = esp32dev",
        "framework = arduino",
      ].join("\n"),
      "void setup() {}\nvoid loop() {}\n",
    );

    mockedListDevicesCore.mockResolvedValue([
      {
        port: "COM7",
        description: "USB UART",
        hwid: "USB VID:PID=303A:1001",
      },
    ]);

    const result = await agentValidateProject(projectDir);

    expect(result.success).toBe(true);
    expect(result.hasPlatformioIni).toBe(true);
    expect(result.environments).toEqual(["esp32dev"]);
    expect(result.boardIds).toEqual(["esp32dev"]);
    expect(result.connectedDevices[0]?.port).toBe("COM7");
    expect(result.nextSteps.some((step) => step.includes("agent_build_diagnose"))).toBe(true);

    const report = readLastAgentReport(projectDir);
    expect(report?.tool).toBe("agent_validate_project");
    expect(report?.success).toBe(true);
  });

  it("reports missing framework entries", async () => {
    const projectDir = createTempProject();
    writeProjectFiles(
      projectDir,
      [
        "[env:esp32dev]",
        "platform = espressif32",
        "board = esp32dev",
      ].join("\n"),
      "void setup() {}\nvoid loop() {}\n",
    );

    const result = await agentValidateProject(projectDir);

    expect(result.success).toBe(false);
    expect(
      result.missingConfigEntries.some((entry) => entry.includes("framework")),
    ).toBe(true);
  });

  it("returns diagnostic-rich build success details", async () => {
    const projectDir = createTempProject();
    mockedBuildProjectCore.mockResolvedValue({
      success: true,
      environment: "esp32dev",
      output: "Building...\nRAM: 1024\nFlash: 4096\n",
      ramUsageBytes: 1024,
      flashUsageBytes: 4096,
      firmwarePath: path.join(projectDir, ".pio", "build", "firmware.bin"),
      diagnostic: {
        errorType: "None",
        summary: "Build completed successfully.",
        recommendedAction: "Proceed to upload_firmware.",
        severity: "info",
        safeToAutoRetry: false,
        evidence: [],
      },
      nextSteps: ["Upload to target device."],
    });

    const result = await agentBuildDiagnose(projectDir, "esp32dev", true, false);

    expect(result.success).toBe(true);
    expect(result.environment).toBe("esp32dev");
    expect(result.ramUsageBytes).toBe(1024);
    expect(result.flashUsageBytes).toBe(4096);
    expect(result.nextSteps).toContain("Upload to target device.");
  });

  it("classifies upload failure with ESP32 pin-risk overlay", async () => {
    const projectDir = createTempProject();
    writeProjectFiles(
      projectDir,
      [
        "[env:esp32dev]",
        "platform = espressif32",
        "board = esp32dev",
        "framework = arduino",
      ].join("\n"),
      [
        "#include <Arduino.h>",
        "#define LED_PIN 12",
        "void setup() { pinMode(LED_PIN, OUTPUT); }",
        "void loop() { digitalWrite(LED_PIN, HIGH); }",
      ].join("\n"),
    );

    mockedBuildProjectCore.mockResolvedValue({
      success: true,
      environment: "esp32dev",
      output: "Build success",
    });

    mockedUploadFirmwareCore.mockResolvedValue({
      success: false,
      output: "A fatal error occurred: Timed out waiting for packet header",
      rawLogPath: path.join(projectDir, "upload.log"),
    });

    const result = await agentFlashMonitorVerify({
      projectDir,
      environment: "esp32dev",
      expectAll: ["BOOT_OK"],
      rejectPatterns: ["Guru Meditation"],
      timeoutSeconds: 1,
      stabilityWindowSeconds: 1,
      autoBuild: true,
    });

    expect(result.success).toBe(false);
    expect(result.verificationStatus).toBe("flash_failed");
    expect(result.diagnostic?.errorType).toBe("Esp32StrappingPinRisk");
    expect(result.recommendedNextAction.toLowerCase()).toContain("avoid strapping pins");
  });

  it("skips pre-build when default environment firmware artifact already exists", async () => {
    const projectDir = createTempProject();
    writeProjectFiles(
      projectDir,
      [
        "[platformio]",
        "default_envs = esp32dev",
        "",
        "[env:esp32dev]",
        "platform = espressif32",
        "board = esp32dev",
        "framework = arduino",
      ].join("\n"),
      "void setup() {}\nvoid loop() {}\n",
    );

    const firmwarePath = path.join(
      projectDir,
      ".pio",
      "build",
      "esp32dev",
      "firmware.bin",
    );
    fs.mkdirSync(path.dirname(firmwarePath), { recursive: true });
    fs.writeFileSync(firmwarePath, "bin", "utf8");
    mockedFindFirmwareArtifact.mockImplementation((projDir, envName) => {
      if (
        projDir === projectDir &&
        envName === "esp32dev"
      ) {
        return firmwarePath;
      }
      return undefined;
    });

    const monitorLogPath = path.join(
      projectDir,
      ".pio-mcp-workspace",
      "logs",
      "monitor",
      "latest-monitor.log",
    );
    fs.mkdirSync(path.dirname(monitorLogPath), { recursive: true });
    fs.writeFileSync(monitorLogPath, "BOOT_OK\n", "utf8");

    mockedBuildProjectCore.mockResolvedValue({
      success: true,
      environment: "esp32dev",
      output: "Build success",
    });
    mockedUploadFirmwareCore.mockResolvedValue({
      success: true,
      port: "COM7",
      output: "Upload succeeded",
    });

    await agentFlashMonitorVerify({
      projectDir,
      expectAll: ["BOOT_OK"],
      timeoutSeconds: 1,
      stabilityWindowSeconds: 1,
      autoBuild: true,
    });

    expect(mockedBuildProjectCore).not.toHaveBeenCalled();
    expect(mockedUploadFirmwareCore).toHaveBeenCalledTimes(1);
  });

  it("returns inconclusive when pre-flash build is running in background", async () => {
    const projectDir = createTempProject();
    writeProjectFiles(
      projectDir,
      [
        "[env:esp32dev]",
        "platform = espressif32",
        "board = esp32dev",
        "framework = arduino",
      ].join("\n"),
      "void setup() {}\nvoid loop() {}\n",
    );

    mockedBuildProjectCore.mockResolvedValue({
      status: "running",
      message: "Task dispatched to background.",
      taskId: "task-123",
    });

    const result = await agentFlashMonitorVerify({
      projectDir,
      environment: "esp32dev",
      autoBuild: true,
    });

    expect(result.success).toBe(false);
    expect(result.verificationStatus).toBe("inconclusive");
    expect(result.recommendedNextAction.toLowerCase()).toContain("background");
    expect(mockedUploadFirmwareCore).not.toHaveBeenCalled();
  });

  it("verifies runtime expectations and exposes persisted report", async () => {
    const projectDir = createTempProject();
    writeProjectFiles(
      projectDir,
      [
        "[env:esp32dev]",
        "platform = espressif32",
        "board = esp32dev",
        "framework = arduino",
      ].join("\n"),
      "void setup() {}\nvoid loop() {}\n",
    );

    const monitorLogPath = path.join(
      projectDir,
      ".pio-mcp-workspace",
      "logs",
      "monitor",
      "latest-monitor.log",
    );
    fs.mkdirSync(path.dirname(monitorLogPath), { recursive: true });
    fs.writeFileSync(monitorLogPath, "BOOT_OK\nHEARTBEAT\n", "utf8");

    mockedFindFirmwareArtifact.mockReturnValue(path.join(projectDir, ".pio", "build", "firmware.bin"));
    mockedUploadFirmwareCore.mockResolvedValue({
      success: true,
      port: "COM7",
      output: "Upload succeeded",
    });

    const result = await agentFlashMonitorVerify({
      projectDir,
      environment: "esp32dev",
      expectAll: ["BOOT_OK"],
      rejectPatterns: ["Guru Meditation", "Brownout detector", "WDT reset"],
      timeoutSeconds: 2,
      stabilityWindowSeconds: 1,
      autoBuild: true,
    });

    expect(result.flashSuccess).toBe(true);
    expect(result.monitorSuccess).toBe(true);
    expect(result.verificationStatus).toBe("passed");
    expect(result.matchedExpectations).toContain("BOOT_OK");
    expect(result.rejectedPatterns).toEqual([]);

    const lastReport = await agentGetLastReport(projectDir);
    expect(lastReport.success).toBe(true);
    expect(lastReport.report?.tool).toBe("agent_flash_monitor_verify");
  });
});
