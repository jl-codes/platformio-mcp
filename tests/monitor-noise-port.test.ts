/**
 * Validates that getFirstDevice() excludes macOS noise ports (debug-console,
 * Bluetooth, Jabra, etc.) and that StartMonitorParamsSchema accepts port aliases.
 *
 * Closes: https://github.com/jl-codes/platformio-mcp/issues/45
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// --- getFirstDevice noise filtering ---

// Mock listDevices to return controlled device lists
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: {
    executeWithJsonOutput: vi.fn(),
  },
}));

import { platformioExecutor } from "../src/platformio.js";
import { getFirstDevice } from "../src/tools/devices.js";
import { StartMonitorParamsSchema } from "../src/types.js";

const mockExecutor = vi.mocked(platformioExecutor.executeWithJsonOutput);

describe("getFirstDevice noise port filtering", () => {
  afterEach(() => vi.restoreAllMocks());

  it("skips /dev/cu.debug-console and selects the real USB CDC device", async () => {
    mockExecutor.mockResolvedValue([
      { port: "/dev/cu.debug-console", description: "n/a", hwid: "n/a" },
      {
        port: "/dev/cu.usbmodem101",
        description: "USB JTAG/serial debug unit",
        hwid: "USB VID:PID=303A:1001 SER=3C:0F:02:DE:72:24 LOCATION=0-1",
      },
    ]);
    const device = await getFirstDevice();
    expect(device).not.toBeNull();
    expect(device!.port).toBe("/dev/cu.usbmodem101");
  });

  it("skips Bluetooth-Incoming-Port", async () => {
    mockExecutor.mockResolvedValue([
      {
        port: "/dev/cu.Bluetooth-Incoming-Port",
        description: "n/a",
        hwid: "n/a",
      },
      {
        port: "/dev/cu.usbmodem101",
        description: "USB JTAG/serial debug unit",
        hwid: "USB VID:PID=303A:1001 SER=ABC",
      },
    ]);
    const device = await getFirstDevice();
    expect(device).not.toBeNull();
    expect(device!.port).toBe("/dev/cu.usbmodem101");
  });

  it("skips Jabra and AirPods audio peripherals", async () => {
    mockExecutor.mockResolvedValue([
      { port: "/dev/cu.Jabra-Elite75t", description: "n/a", hwid: "n/a" },
      { port: "/dev/cu.AirPods-Pro", description: "n/a", hwid: "n/a" },
      {
        port: "/dev/ttyUSB0",
        description: "CP2102 USB to UART",
        hwid: "USB VID:PID=10C4:EA60 SER=0001",
      },
    ]);
    const device = await getFirstDevice();
    expect(device).not.toBeNull();
    expect(device!.port).toBe("/dev/ttyUSB0");
  });

  it("filters out n/a hwid + n/a description virtual ports", async () => {
    mockExecutor.mockResolvedValue([
      { port: "/dev/cu.some-virtual", description: "n/a", hwid: "n/a" },
      {
        port: "/dev/cu.usbmodem101",
        description: "ESP32-S3",
        hwid: "USB VID:PID=303A:1001 SER=XYZ",
      },
    ]);
    const device = await getFirstDevice();
    expect(device).not.toBeNull();
    expect(device!.port).toBe("/dev/cu.usbmodem101");
  });

  it("falls back to first raw device when ALL devices are noise", async () => {
    mockExecutor.mockResolvedValue([
      { port: "/dev/cu.debug-console", description: "n/a", hwid: "n/a" },
      {
        port: "/dev/cu.Bluetooth-Incoming-Port",
        description: "n/a",
        hwid: "n/a",
      },
    ]);
    const device = await getFirstDevice();
    // Should fall back rather than returning null
    expect(device).not.toBeNull();
    expect(device!.port).toBe("/dev/cu.debug-console");
  });

  it("returns null when no devices are present", async () => {
    mockExecutor.mockResolvedValue([]);
    const device = await getFirstDevice();
    expect(device).toBeNull();
  });
});

// --- StartMonitorParamsSchema alias tests ---

describe("StartMonitorParamsSchema port aliases", () => {
  it("passes port through directly", () => {
    const result = StartMonitorParamsSchema.parse({
      port: "/dev/cu.usbmodem101",
    });
    expect(result.port).toBe("/dev/cu.usbmodem101");
  });

  it("maps uploadPort to port", () => {
    const result = StartMonitorParamsSchema.parse({
      uploadPort: "/dev/cu.usbmodem101",
    });
    expect(result.port).toBe("/dev/cu.usbmodem101");
  });

  it("maps upload_port to port", () => {
    const result = StartMonitorParamsSchema.parse({
      upload_port: "/dev/cu.usbmodem101",
    });
    expect(result.port).toBe("/dev/cu.usbmodem101");
  });

  it("prefers port over uploadPort alias", () => {
    const result = StartMonitorParamsSchema.parse({
      port: "/dev/cu.usbmodem101",
      uploadPort: "/dev/cu.usbmodem999",
    });
    expect(result.port).toBe("/dev/cu.usbmodem101");
  });

  it("treats empty-string port as absent and falls through to alias", () => {
    const result = StartMonitorParamsSchema.parse({
      port: "",
      uploadPort: "/dev/cu.usbmodem101",
    });
    expect(result.port).toBe("/dev/cu.usbmodem101");
  });

  it("returns undefined port when none provided", () => {
    const result = StartMonitorParamsSchema.parse({ baudRate: 115200 });
    expect(result.port).toBeUndefined();
  });
});
