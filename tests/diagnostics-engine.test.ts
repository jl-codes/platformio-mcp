import { describe, expect, it } from "vitest";
import { diagnoseBuildLog } from "../src/core/diagnostics/build-diagnostics.js";
import { diagnoseUploadLog } from "../src/core/diagnostics/upload-diagnostics.js";
import { diagnoseSerialLog } from "../src/core/diagnostics/serial-diagnostics.js";

describe("Diagnostics Engine", () => {
  it("classifies build MissingHeader failures", () => {
    const result = diagnoseBuildLog(
      "src/main.cpp:1:10: fatal error: WiFi.h: No such file or directory",
      { rawLogPath: ".pio-mcp-workspace/logs/build/a.log" },
    );

    expect(result.success).toBe(false);
    expect(result.stage).toBe("build");
    expect(result.errorType).toBe("MissingHeader");
    expect(result.recommendedAction).toContain("Install the missing library");
    expect(result.rawLogPath).toContain(".pio-mcp-workspace/logs/build/a.log");
  });

  it("classifies upload PortBusy failures", () => {
    const result = diagnoseUploadLog("Error: [Errno 16] Resource busy", {
      taskId: "upload-123",
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe("upload");
    expect(result.errorType).toBe("PortBusy");
    expect(result.safeToAutoRetry).toBe(true);
    expect(result.taskId).toBe("upload-123");
  });

  it("classifies serial panic traces", () => {
    const result = diagnoseSerialLog("Guru Meditation Error: Core  1 panic'ed");
    expect(result.success).toBe(false);
    expect(result.stage).toBe("monitor");
    expect(result.errorType).toBe("PanicTrace");
    expect(result.severity).toBe("critical");
  });

  it("returns Unknown for unmatched failures", () => {
    const result = diagnoseBuildLog("something failed but unknown shape");
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("Unknown");
  });

  it("supports successful override", () => {
    const result = diagnoseBuildLog("Processing esp32dev", { success: true });
    expect(result.success).toBe(true);
    expect(result.severity).toBe("info");
  });
});

