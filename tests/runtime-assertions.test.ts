import { describe, expect, it } from "vitest";
import { evaluateRuntimeAssertions } from "../src/core/runtime-assertions.js";

describe("Runtime Assertions Engine", () => {
  it("matches expectations and keeps unmatched list", () => {
    const result = evaluateRuntimeAssertions({
      serialOutput: "BOOT_OK\nHEARTBEAT\n",
      expectAll: ["BOOT_OK", "READY"],
      rejectPatterns: ["Guru Meditation"],
      stabilityWindowSeconds: 5,
      secondsSinceLastOutput: 8,
    });

    expect(result.matchedExpectations).toEqual(["BOOT_OK"]);
    expect(result.unmatchedExpectations).toEqual(["READY"]);
    expect(result.rejectedPatterns).toEqual([]);
    expect(result.stabilityAchieved).toBe(true);
  });

  it("detects rejected patterns and runtime failures", () => {
    const result = evaluateRuntimeAssertions({
      serialOutput:
        "Guru Meditation Error\nbrownout detector was triggered\nrst:0x10\nrst:0x10\n",
      rejectPatterns: ["Guru Meditation"],
      stabilityWindowSeconds: 3,
      secondsSinceLastOutput: 1,
    });

    expect(result.rejectedPatterns).toEqual(["Guru Meditation"]);
    expect(result.runtimeFailures).toContain("PanicTrace");
    expect(result.runtimeFailures).toContain("Brownout");
    expect(result.runtimeFailures).toContain("BootLoop");
    expect(result.stabilityAchieved).toBe(false);
  });

  it("reports no serial output failure", () => {
    const result = evaluateRuntimeAssertions({
      serialOutput: "",
      expectAll: ["BOOT_OK"],
      stabilityWindowSeconds: 4,
      secondsSinceLastOutput: 10,
    });

    expect(result.runtimeFailures).toContain("NoSerialOutput");
    expect(result.matchedExpectations).toEqual([]);
    expect(result.unmatchedExpectations).toEqual(["BOOT_OK"]);
  });
});
