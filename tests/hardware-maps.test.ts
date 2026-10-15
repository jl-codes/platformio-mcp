/**
 * Hardware Maps and USB VID:PID Resolution Unit Tests
 *
 * Provides:
 * - Tests for USB VID:PID mapping and board inference
 * - Tests for ESP32-S3/C3 native USB CDC and JTAG definitions
 * - Tests for pattern-based fallback resolution
 */

import { describe, expect, it } from "vitest";
import {
  boardPatterns,
  mapVidPidToBoard,
  vidPidDatabase,
} from "../src/utils/hardware-maps.js";

describe("hardware maps - vidPidDatabase", () => {
  it("contains Espressif native USB CDC entries with expected boards and confidence", () => {
    expect(vidPidDatabase["303a:1001"]).toEqual({
      boards: ["esp32-s3-devkitc-1", "esp32s3box", "esp32-s3-devkitm-1"],
      confidence: "high",
    });

    expect(vidPidDatabase["303a:1002"]).toEqual({
      boards: ["esp32-s2-saola-1"],
      confidence: "high",
    });

    expect(vidPidDatabase["303a:0002"]).toEqual({
      boards: ["esp32-s2-saola-1"],
      confidence: "medium",
    });
  });

  it("resolves ESP32-S3 boards from USB VID:PID=303A:1001", () => {
    const board = mapVidPidToBoard(
      "USB VID:PID=303A:1001",
      "USB JTAG/serial debug unit",
    );
    expect(board).toBe("esp32-s3-devkitc-1");
  });

  it("handles case-insensitive hex VID:PID formats", () => {
    expect(mapVidPidToBoard("USB VID:PID=303a:1001")).toBe("esp32-s3-devkitc-1");
    expect(mapVidPidToBoard("USB VID_303A&PID_1001")).toBe("esp32-s3-devkitc-1");
    expect(mapVidPidToBoard("USB VID:PID=303A:1002")).toBe("esp32-s2-saola-1");
    expect(mapVidPidToBoard("USB VID:PID=303a:0002")).toBe("esp32-s2-saola-1");
  });

  it("preserves standard legacy board mappings", () => {
    expect(mapVidPidToBoard("USB VID:PID=2341:0043")).toBe("uno");
    expect(mapVidPidToBoard("USB VID:PID=2E8A:0005")).toBe("pico");
    expect(mapVidPidToBoard("USB VID:PID=0483:374B")).toBe("nucleo_f103rb");
  });
});

describe("hardware maps - boardPatterns", () => {
  it("includes an Espressif USB JTAG / serial debug unit pattern", () => {
    const jtagPattern = boardPatterns.find((entry) =>
      entry.patterns.some((p) => p.test("USB JTAG/serial debug unit")),
    );
    expect(jtagPattern).toBeDefined();
    expect(jtagPattern?.boardType).toBe("ESP32-S3/C3");
    expect(jtagPattern?.boards).toContain("esp32-s3-devkitc-1");
    expect(jtagPattern?.boards).toContain("esp32-c3-devkitm-1");
  });

  it("falls back to pattern matching when VID:PID is absent or unknown", () => {
    const resolvedFromDescription = mapVidPidToBoard(
      "UNKNOWN_HWID",
      "USB JTAG/serial debug unit",
    );
    expect(resolvedFromDescription).toBe("esp32-s3-devkitc-1");

    const resolvedFromEspressif = mapVidPidToBoard(
      "n/a",
      "Espressif Device",
    );
    expect(resolvedFromEspressif).toBe("esp32-s3-devkitc-1");
  });

  it("returns undefined when no pattern matches", () => {
    expect(mapVidPidToBoard("UNKNOWN_HWID", "Unknown Generic Device")).toBeUndefined();
  });
});
