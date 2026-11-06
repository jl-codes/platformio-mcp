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
  mapVidPidToBoard,
  mapVidPidToPlatform,
  vidPidDatabase,
} from "../src/utils/hardware-maps.js";

describe("hardware maps - vidPidDatabase", () => {
  it("records shared Espressif USB IDs as platform hints, not exact boards", () => {
    expect(vidPidDatabase["303a:1001"]).toEqual({
      boards: [],
      confidence: "medium",
      platform: "espressif32",
    });
  });

  it("does not infer an exact board from shared Espressif USB IDs", () => {
    expect(mapVidPidToBoard("USB VID:PID=303A:1001", "USB JTAG/serial debug unit")).toBeUndefined();
    expect(mapVidPidToPlatform("USB VID:PID=303A:1001")).toBe("espressif32");
  });

  it("handles case-insensitive hex VID:PID formats", () => {
    expect(mapVidPidToPlatform("USB VID:PID=303a:1001")).toBe("espressif32");
    expect(mapVidPidToPlatform("USB VID_303A&PID_1001")).toBe("espressif32");
    expect(mapVidPidToBoard("USB VID:PID=303A:1002")).toBeUndefined();
    expect(mapVidPidToBoard("USB VID:PID=303a:0002")).toBeUndefined();
  });

  it("preserves standard legacy board mappings", () => {
    expect(mapVidPidToBoard("USB VID:PID=2341:0043")).toBe("uno");
    expect(mapVidPidToBoard("USB VID:PID=2E8A:0005")).toBe("pico");
    expect(mapVidPidToBoard("USB VID:PID=0483:374B")).toBe("nucleo_f103rb");
  });
});

describe("hardware maps - boardPatterns", () => {
  it("does not infer exact boards from broad Espressif descriptions", () => {
    const resolvedFromDescription = mapVidPidToBoard(
      "UNKNOWN_HWID",
      "USB JTAG/serial debug unit",
    );
    expect(resolvedFromDescription).toBeUndefined();

    const resolvedFromEspressif = mapVidPidToBoard(
      "n/a",
      "Espressif Device",
    );
    expect(resolvedFromEspressif).toBeUndefined();
  });

  it("returns undefined when no pattern matches", () => {
    expect(mapVidPidToBoard("UNKNOWN_HWID", "Unknown Generic Device")).toBeUndefined();
  });
});
