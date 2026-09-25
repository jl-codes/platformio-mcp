/** Upload selections reach PlatformIO exactly and custody errors survive adapter boundaries. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { uploadFirmware, uploadFilesystem } from "../src/tools/upload.js";
import * as spooler from "../src/utils/spooler.js";
import * as monitor from "../src/tools/monitor.js";
import * as devices from "../src/tools/devices.js";
import { portSemaphoreManager } from "../src/utils/semaphore.js";
import fs from "node:fs";
import { PlatformIOError } from "../src/utils/errors.js";

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
    vi.spyOn(portSemaphoreManager, "claimPort").mockImplementation(() => {});
    vi.spyOn(portSemaphoreManager, "releasePort").mockImplementation(() => {});
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
  it.each([
    ["firmware", uploadFirmware, "upload"],
    ["filesystem", uploadFilesystem, "uploadfs"],
  ] as const)(
    "pins selected port in %s upload argv",
    async (_name, upload, target) => {
      await upload(mockProjectDir, "COM7", "default", false, false, false);
      expect(spooler.executeWithSpooling).toHaveBeenCalledWith(
        "run",
        [
          "--target",
          target,
          "--environment",
          "default",
          "--upload-port",
          "COM7",
        ],
        expect.objectContaining({ activePort: "COM7" }),
      );
    },
  );

  it.each([uploadFirmware, uploadFilesystem])(
    "pins the resolved fallback port in argv",
    async (upload) => {
      await upload(mockProjectDir, undefined, "default", false, false, false);
      const call = vi.mocked(spooler.executeWithSpooling).mock.calls[0];
      expect(call[1].slice(-2)).toEqual(["--upload-port", "COM1"]);
      expect(call[2].activePort).toBe("COM1");
    },
  );

  it.each([uploadFirmware, uploadFilesystem])(
    "retains uncertain custody through upload failure",
    async (upload) => {
      const failure = new PlatformIOError(
        "termination unconfirmed",
        "PROCESS_CLEANUP_PENDING",
        {
          cleanupPending: true,
          fullLogPath: "fixture.log",
        },
      );
      vi.mocked(spooler.executeWithSpooling).mockRejectedValueOnce(failure);
      await expect(upload(mockProjectDir, "COM1", "default")).rejects.toBe(
        failure,
      );
      expect(portSemaphoreManager.releasePort).not.toHaveBeenCalled();
    },
  );
  it.each([uploadFirmware, uploadFilesystem])(
    "never falls back to a different board after upload",
    async (upload) => {
      vi.mocked(devices.waitForDeviceByHwid).mockResolvedValueOnce(null);
      vi.spyOn(console, "error").mockImplementation(() => {});
      await upload(mockProjectDir, "COM1", "default", false, false, true);
      await vi.mocked(spooler.executeWithSpooling).mock.calls[0][2]
        .onSuccess!();
      expect(devices.getFirstDevice).not.toHaveBeenCalled();
      expect(monitor.startMonitor).not.toHaveBeenCalled();
    },
  );
});
