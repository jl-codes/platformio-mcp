import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diagnoseBuildLog } from "../src/core/diagnostics/build-diagnostics.js";
import { diagnoseSerialLog } from "../src/core/diagnostics/serial-diagnostics.js";
import { diagnoseUploadLog } from "../src/core/diagnostics/upload-diagnostics.js";

const FIXTURE_DIR = path.join(process.cwd(), "tests", "__fixtures__", "logs");

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
}

describe("Extended Diagnostic Matchers", () => {
  it("matches MissingHeader from fixture log", () => {
    const result = diagnoseBuildLog(readFixture("missing-header.log"));
    expect(result.errorType).toBe("MissingHeader");
  });

  it("matches LinkerError from fixture log", () => {
    const result = diagnoseBuildLog(readFixture("linker-error.log"));
    expect(result.errorType).toBe("LinkerError");
  });

  it("matches UnknownBoard build failures", () => {
    const result = diagnoseBuildLog("Error: Unknown board ID 'esp32-custom'");
    expect(result.errorType).toBe("UnknownBoard");
  });

  it("matches UnknownFramework build failures", () => {
    const result = diagnoseBuildLog("Error: unknown framework 'mystery-fw'");
    expect(result.errorType).toBe("UnknownFramework");
  });

  it("matches PortBusy upload failures from fixture", () => {
    const result = diagnoseUploadLog(readFixture("port-busy.log"));
    expect(result.errorType).toBe("PortBusy");
    expect(result.safeToAutoRetry).toBe(true);
  });

  it("matches UploadSyncFailed upload failures", () => {
    const result = diagnoseUploadLog("Timed out waiting for packet header");
    expect(result.errorType).toBe("UploadSyncFailed");
  });

  it("matches PermissionDenied upload failures", () => {
    const result = diagnoseUploadLog("Permission denied while opening serial port");
    expect(result.errorType).toBe("PermissionDenied");
  });

  it("matches DeviceDisconnected upload failures", () => {
    const result = diagnoseUploadLog("No such file or directory: /dev/ttyUSB0");
    expect(result.errorType).toBe("DeviceDisconnected");
  });

  it("matches Esp32StrappingPinRisk upload failures", () => {
    const result = diagnoseUploadLog("ESP32 strapping pin risk detected");
    expect(result.errorType).toBe("Esp32StrappingPinRisk");
  });

  it("matches Brownout runtime failures from fixture", () => {
    const result = diagnoseSerialLog(readFixture("brownout.log"));
    expect(result.errorType).toBe("Brownout");
  });

  it("matches WatchdogReset runtime failures from fixture", () => {
    const result = diagnoseSerialLog(readFixture("watchdog.log"));
    expect(result.errorType).toBe("WatchdogReset");
  });

  it("matches PanicTrace runtime failures from fixture", () => {
    const result = diagnoseSerialLog(readFixture("guru-meditation.log"));
    expect(result.errorType).toBe("PanicTrace");
  });

  it("matches BootLoop runtime failures from fixture", () => {
    const result = diagnoseSerialLog(readFixture("boot-loop.log"));
    expect(result.errorType).toBe("BootLoop");
  });

  it("matches NoSerialOutput runtime failures", () => {
    const result = diagnoseSerialLog("");
    expect(result.errorType).toBe("NoSerialOutput");
  });
});
