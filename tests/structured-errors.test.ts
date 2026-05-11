/**
 * Tests for parseStructuredBuildErrors / deriveNextSteps.
 *
 * These were added in response to EmbedBench traces where agents struggled
 * to act on raw `pio` stderr blobs. The goal of the structured layer is:
 * each detected failure becomes a {category, file, line, message} tuple, and
 * `deriveNextSteps` translates the category set into a short action list.
 */
import { describe, it, expect } from "vitest";
import {
  parseStructuredBuildErrors,
  deriveNextSteps,
} from "../src/utils/errors.js";

describe("parseStructuredBuildErrors", () => {
  it("returns [] for an empty/success log", () => {
    expect(parseStructuredBuildErrors("")).toEqual([]);
    expect(parseStructuredBuildErrors("Compiling .pio/build/dev/src/main.cpp.o\nSUCCESS\n")).toEqual([]);
  });

  it("detects missing-header fatal errors with file+line", () => {
    const log =
      "src/main.cpp:7:10: fatal error: WiFi.h: No such file or directory\n   7 | #include <WiFi.h>\n      |          ^~~~~~~~\ncompilation terminated.";
    const errors = parseStructuredBuildErrors(log);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const hit = errors.find((e) => e.category === "missing_header");
    expect(hit).toBeDefined();
    expect(hit!.file).toBe("src/main.cpp");
    expect(hit!.line).toBe(7);
    expect(hit!.message.toLowerCase()).toContain("wifi.h");
  });

  it("detects linker undefined references", () => {
    const log =
      ".pio/build/dev/src/main.cpp.o: in function `setup':\nmain.cpp:(.text+0x10): undefined reference to `myMissingFunction'\ncollect2: error: ld returned 1 exit status";
    const errors = parseStructuredBuildErrors(log);
    expect(errors.some((e) => e.category === "undefined_reference")).toBe(true);
  });

  it("detects PIO-level missing platformio.ini", () => {
    const log = "Error: Project does not seem to be a PlatformIO Project. `platformio.ini` not found.";
    const errors = parseStructuredBuildErrors(log);
    expect(errors.some((e) => e.category === "missing_platformio_ini")).toBe(true);
  });

  it("detects unknown-environment errors", () => {
    const log = "UnknownEnvNames: Unknown environment names 'dev'";
    const errors = parseStructuredBuildErrors(log);
    expect(errors.some((e) => e.category === "missing_environment")).toBe(true);
  });
});

describe("deriveNextSteps", () => {
  it("returns success guidance when build succeeded with no errors", () => {
    const steps = deriveNextSteps([], true);
    expect(steps.length).toBeGreaterThan(0);
  });

  it("translates missing_header errors into install_library / lib_deps guidance", () => {
    const steps = deriveNextSteps(
      [
        {
          category: "missing_header",
          message: "WiFi.h: No such file or directory",
          file: "src/main.cpp",
          line: 7,
          raw: "src/main.cpp:7:10: fatal error: WiFi.h: No such file or directory",
        },
      ],
      false,
    );
    expect(steps.join("\n")).toMatch(/install_library|lib_deps|search_libraries/i);
  });

  it("translates missing_environment into a platformio.ini env-add hint", () => {
    const steps = deriveNextSteps(
      [
        {
          category: "missing_environment",
          message: "Unknown environment names 'dev'",
          raw: "UnknownEnvNames: Unknown environment names 'dev'",
        },
      ],
      false,
    );
    expect(steps.join("\n")).toMatch(/environment|platformio\.ini/i);
  });
});
