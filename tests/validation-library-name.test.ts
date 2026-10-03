import { describe, it, expect } from "vitest";
import { validateLibraryName } from "../src/utils/validation.js";

describe("validateLibraryName", () => {
  it("accepts PlatformIO's canonical owner/name form", () => {
    // The registry's own identifier format; rejecting it made install_library
    // refuse the most common way users name a library.
    expect(validateLibraryName("bblanchon/ArduinoJson")).toBe(true);
    expect(validateLibraryName("adafruit/Adafruit GFX Library")).toBe(true);
    expect(validateLibraryName("me-no-dev/ESPAsyncTCP")).toBe(true);
  });

  it("still accepts bare names and ids", () => {
    expect(validateLibraryName("ArduinoJson")).toBe(true);
    expect(validateLibraryName("Adafruit GFX Library")).toBe(true);
    expect(validateLibraryName("64")).toBe(true);
    expect(validateLibraryName("ArduinoJson@6.21.3")).toBe(true);
  });

  it("refuses path traversal", () => {
    expect(validateLibraryName("../etc/passwd")).toBe(false);
    expect(validateLibraryName("owner/../../etc")).toBe(false);
    expect(validateLibraryName("..")).toBe(false);
  });

  it("refuses more than one slash, or a leading or trailing slash", () => {
    expect(validateLibraryName("a/b/c")).toBe(false);
    expect(validateLibraryName("/ArduinoJson")).toBe(false);
    expect(validateLibraryName("ArduinoJson/")).toBe(false);
  });

  it("refuses shell metacharacters and empty input", () => {
    expect(validateLibraryName("lib; rm -rf /")).toBe(false);
    expect(validateLibraryName("lib && whoami")).toBe(false);
    expect(validateLibraryName("lib$(id)")).toBe(false);
    expect(validateLibraryName("")).toBe(false);
    expect(validateLibraryName("x".repeat(101))).toBe(false);
  });
});
