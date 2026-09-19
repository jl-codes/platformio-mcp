import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { uploadFirmware, uploadFilesystem } from "../src/tools/upload.js";
import * as spooler from "../src/utils/spooler.js";
import * as monitor from "../src/tools/monitor.js";
import * as devices from "../src/tools/devices.js";
import {
  portSemaphoreManager,
  type PortClaim,
} from "../src/utils/semaphore.js";
import fs from "node:fs";

const mockProjectDir = path.join(process.cwd(), "test-project-upload");

describe("Upload Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Create dummy project dir so validateProjectPath doesn't throw
    if (!fs.existsSync(mockProjectDir)) {
      fs.mkdirSync(mockProjectDir, { recursive: true });
    }
    // Mock the platformio.ini file so validation passes
    fs.writeFileSync(
      path.join(mockProjectDir, "platformio.ini"),
      "[env:default]\nboard = esp32dev",
    );

    vi.spyOn(spooler, "executeWithSpooling").mockResolvedValue({
      exitCode: 0,
      message: "Mocked spooling success",
      logPath: "mocked.log",
      finalOutput: "Success",
    });
    vi.spyOn(monitor, "stopMonitor").mockResolvedValue({
      success: true,
      message: "Stopped",
    });
    vi.spyOn(monitor, "startMonitor").mockResolvedValue({
      success: true,
      message: "Started",
      port: "COM1",
      pid: 1234,
    });
    vi.spyOn(portSemaphoreManager, "claimPort").mockImplementation(
      (port: string): PortClaim => ({
        type: "upload",
        owner_workspace: process.cwd(),
        owner_pid: process.pid,
        hostname: "mock-host",
        timestamp: Date.now(),
        port,
      }),
    );
    vi.spyOn(portSemaphoreManager, "releasePort").mockImplementation(
      () => true,
    );
    vi.spyOn(devices, "getFirstDevice").mockResolvedValue({
      port: "COM1",
      description: "Mock Device",
      hwid: "123",
    });
    vi.spyOn(devices, "findDeviceByPort").mockResolvedValue({
      port: "COM1",
      description: "Mock Device",
      hwid: "123",
    });
    vi.spyOn(devices, "waitForDeviceByHwid").mockResolvedValue("COM1");
  });

  afterEach(() => {
    if (fs.existsSync(mockProjectDir)) {
      fs.rmSync(mockProjectDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("should upload firmware without starting monitor if startMonitorAfter is false", async () => {
    const result = await uploadFirmware(
      mockProjectDir,
      "COM1",
      "default",
      false,
      false,
      false,
    );

    expect(result.success).toBe(true);
    expect(monitor.stopMonitor).toHaveBeenCalledWith("COM1", mockProjectDir);
    expect(portSemaphoreManager.claimPort).toHaveBeenCalledWith(
      "COM1",
      "Firmware Upload",
    );

    // Check that executeWithSpooling was called correctly
    expect(spooler.executeWithSpooling).toHaveBeenCalled();
    const spoolingOptions = vi.mocked(spooler.executeWithSpooling).mock
      .calls[0][2];
    expect(spoolingOptions.activePort).toBe("COM1");
    expect(spoolingOptions.onSuccess).toBeUndefined();
  });

  it("should upload firmware and start monitor when startMonitorAfter is true", async () => {
    vi.useFakeTimers();

    const result = await uploadFirmware(
      mockProjectDir,
      "COM1",
      "default",
      false,
      false,
      true,
    );

    expect(result.success).toBe(true);
    expect(monitor.stopMonitor).toHaveBeenCalledWith("COM1", mockProjectDir);
    expect(portSemaphoreManager.claimPort).toHaveBeenCalledWith(
      "COM1",
      "Firmware Upload",
    );

    // Check that executeWithSpooling got onSuccess callback
    const spoolingOptions = vi.mocked(spooler.executeWithSpooling).mock
      .calls[0][2];
    expect(spoolingOptions.onSuccess).toBeDefined();

    // Trigger the onSuccess callback
    const promise = spoolingOptions.onSuccess!();

    // Fast-forward 3 seconds
    await vi.runAllTimersAsync();
    await promise;

    expect(devices.waitForDeviceByHwid).toHaveBeenCalledWith(
      "123",
      10000,
      expect.any(Function),
    );
    expect(monitor.startMonitor).toHaveBeenCalledWith(
      "COM1",
      undefined,
      mockProjectDir,
      "default",
      expect.any(String),
    );

    vi.useRealTimers();
  });

  it("should upload filesystem and start monitor when startMonitorAfter is true", async () => {
    vi.useFakeTimers();

    const result = await uploadFilesystem(
      mockProjectDir,
      "COM1",
      "default",
      false,
      false,
      true,
    );

    expect(result.success).toBe(true);
    expect(monitor.stopMonitor).toHaveBeenCalledWith("COM1", mockProjectDir);
    expect(portSemaphoreManager.claimPort).toHaveBeenCalledWith(
      "COM1",
      "Filesystem Upload",
    );

    const spoolingOptions = vi.mocked(spooler.executeWithSpooling).mock
      .calls[0][2];
    expect(spoolingOptions.onSuccess).toBeDefined();

    const promise = spoolingOptions.onSuccess!();
    await vi.runAllTimersAsync();
    await promise;

    expect(monitor.startMonitor).toHaveBeenCalledWith(
      "COM1",
      undefined,
      mockProjectDir,
      "default",
      expect.any(String),
    );

    vi.useRealTimers();
  });

  it("surfaces PORT_BUSY unchanged when the port is already claimed", async () => {
    const { PortBusyError } = await import("../src/utils/semaphore.js");
    vi.spyOn(portSemaphoreManager, "claimPort").mockImplementation(() => {
      throw new PortBusyError("COM1", {
        type: "upload",
        owner_workspace: "/tmp/other",
        owner_pid: 4242,
        hostname: "h",
        timestamp: Date.now(),
      });
    });

    await expect(
      uploadFirmware(mockProjectDir, "COM1", undefined, false, false, false),
    ).rejects.toMatchObject({ code: "PORT_BUSY" });
  });

  it("surfaces PORT_BUSY unchanged for filesystem uploads", async () => {
    const { PortBusyError } = await import("../src/utils/semaphore.js");
    vi.spyOn(portSemaphoreManager, "claimPort").mockImplementation(() => {
      throw new PortBusyError("COM1", {
        type: "upload",
        owner_workspace: "/tmp/other",
        owner_pid: 4242,
        hostname: "h",
        timestamp: Date.now(),
      });
    });

    await expect(
      uploadFilesystem(mockProjectDir, "COM1", undefined, false, false, false),
    ).rejects.toMatchObject({ code: "PORT_BUSY" });
  });

  it("surfaces CLAIM_IO_ERROR unchanged", async () => {
    const { ClaimIoError } = await import("../src/utils/semaphore.js");
    vi.spyOn(portSemaphoreManager, "claimPort").mockImplementation(() => {
      throw new ClaimIoError(
        "link",
        "/tmp/x.json",
        Object.assign(new Error("no space"), { code: "ENOSPC" }),
      );
    });

    await expect(
      uploadFirmware(mockProjectDir, "COM1", undefined, false, false, false),
    ).rejects.toMatchObject({ code: "CLAIM_IO_ERROR" });
  });
});

describe("Upload claim release on spooler failure", () => {
  // The spooler releases the claim on normal completion only. If the spawn
  // fails or waitForProcessEnd times out it rejects before that code runs, so
  // under the long-lived MCP server the claim outlived the upload and, with a
  // live owner PID, wedged the port until `port release --force`.
  it("releases the port claim when executeWithSpooling rejects", async () => {
    vi.spyOn(spooler, "executeWithSpooling").mockRejectedValue(
      new Error("Process timeout"),
    );
    vi.spyOn(monitor, "stopMonitor").mockResolvedValue({
      success: true,
      message: "Stopped",
    });
    vi.spyOn(devices, "findDeviceByPort").mockResolvedValue({
      port: "COM1",
      description: "d",
      hwid: "1",
    });
    const claim = vi
      .spyOn(portSemaphoreManager, "claimPort")
      .mockImplementation(() => ({
        type: "upload" as const,
        owner_workspace: "/tmp",
        owner_pid: process.pid,
        hostname: "h",
        timestamp: Date.now(),
      }));
    const release = vi
      .spyOn(portSemaphoreManager, "releasePort")
      .mockImplementation(() => true);
    fs.mkdirSync(mockProjectDir, { recursive: true });
    fs.writeFileSync(
      path.join(mockProjectDir, "platformio.ini"),
      "[env:default]\nboard = esp32dev",
    );

    await expect(
      uploadFirmware(mockProjectDir, "COM1", undefined, false, false, false),
    ).rejects.toBeTruthy();

    expect(claim).toHaveBeenCalledWith("COM1", "Firmware Upload");
    expect(release).toHaveBeenCalledWith("COM1");
    fs.rmSync(mockProjectDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
});
