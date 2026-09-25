import { describe, it, expect } from "vitest";
import { parsePlatformioMemory } from "../src/core/analysis/platformio-memory.js";
const output =
  "RAM: [= ] 5.5% (used 18040 bytes from 327680 bytes)\nFlash: [= ] 7.0% (used 233161 bytes from 3342336 bytes)";
describe("PlatformIO memory accounting", () => {
  it("preserves observed program limits rather than physical flash chip capacity", () =>
    expect(parsePlatformioMemory(output)).toEqual({
      ram: { usedBytes: 18040, totalBytes: 327680, percent: 5.5 },
      flash: { usedBytes: 233161, totalBytes: 3342336, percent: 7 },
    }));
  it("accepts ANSI output", () =>
    expect(
      parsePlatformioMemory("\x1b[32m" + output + "\x1b[0m"),
    ).toBeDefined());
  it("does not call partial output complete accounting", () =>
    expect(parsePlatformioMemory(output.split("\n")[0])).toBeUndefined());
  it("rejects duplicate environments rather than using the last result", () =>
    expect(() => parsePlatformioMemory(output + "\n" + output)).toThrow(
      "Multiple size-check",
    ));
  it("rejects inconsistent and unsafe numbers", () => {
    expect(() =>
      parsePlatformioMemory(output.replace("5.5%", "99.0%")),
    ).toThrow("inconsistent");
    expect(() => parsePlatformioMemory(output.replace("327680", "0"))).toThrow(
      "inconsistent",
    );
    expect(() =>
      parsePlatformioMemory(output.replace("18040", "9007199254740993")),
    ).toThrow("inconsistent");
  });
});
