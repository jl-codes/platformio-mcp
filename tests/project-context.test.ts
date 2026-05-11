/**
 * Tests for `getProjectContext` — the single-call orientation tool that
 * replaces the EmbedBench-observed "read 4 files before doing anything" ritual.
 *
 * We mock `./tools/devices.js#listDevices` to avoid spawning `pio` in tests,
 * then verify the produced ProjectContext shape across a few realistic
 * project states: missing INI, well-formed INI, multi-env INI, warm cache.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock device discovery so getProjectContext doesn't shell out.
vi.mock("../src/tools/devices.js", () => ({
  listDevices: vi.fn().mockResolvedValue([
    { port: "/dev/cu.usbserial-1410", description: "USB Serial", detectedBoard: "esp32dev" },
  ]),
}));

import { getProjectContext } from "../src/tools/projects.js";
import {
  lookupBuildCache,
  writeCache,
} from "../src/utils/build-cache.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "piomcp-ctx-"));
});

afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
  vi.clearAllMocks();
});

describe("getProjectContext", () => {
  it("returns hasPlatformioIni=false and an init-first nextStep when INI missing", async () => {
    const ctx = await getProjectContext(tmp);
    expect(ctx.hasPlatformioIni).toBe(false);
    expect(ctx.environments).toBeUndefined();
    expect(ctx.nextSteps.some((s) => /init_project/i.test(s))).toBe(true);
  });

  it("parses environments and lib_deps from a real platformio.ini", async () => {
    fs.writeFileSync(
      path.join(tmp, "platformio.ini"),
      [
        "[env:esp32dev]",
        "platform = espressif32",
        "board = esp32dev",
        "framework = arduino",
        "lib_deps =",
        "    bblanchon/ArduinoJson@^6.21.0",
        "    adafruit/Adafruit GFX Library@^1.11.5",
        "",
        "[env:native]",
        "platform = native",
      ].join("\n"),
    );
    fs.mkdirSync(path.join(tmp, "src"));
    fs.writeFileSync(path.join(tmp, "src", "main.cpp"), "int main(){}\n");

    const ctx = await getProjectContext(tmp);
    expect(ctx.hasPlatformioIni).toBe(true);
    expect(ctx.environments).toEqual(["esp32dev", "native"]);
    expect(ctx.defaultEnvironment).toBe("esp32dev");
    expect(ctx.libDeps).toEqual(
      expect.arrayContaining([
        "bblanchon/ArduinoJson@^6.21.0",
        "adafruit/Adafruit GFX Library@^1.11.5",
      ]),
    );
    expect(ctx.sourceFiles).toContain("src/main.cpp");
    expect(ctx.connectedDevices?.[0]?.port).toBe("/dev/cu.usbserial-1410");
  });

  it("flags multi-env projects so agents pass --environment explicitly", async () => {
    fs.writeFileSync(
      path.join(tmp, "platformio.ini"),
      "[env:a]\nplatform = native\n[env:b]\nplatform = native\n",
    );
    fs.mkdirSync(path.join(tmp, "src"));
    fs.writeFileSync(path.join(tmp, "src", "main.cpp"), "");

    const ctx = await getProjectContext(tmp);
    expect(
      ctx.nextSteps.some((s) => /Multiple environments/i.test(s)),
    ).toBe(true);
  });

  it("reports cacheReady=true when build-cache has a fresh hash for the default env", async () => {
    fs.writeFileSync(
      path.join(tmp, "platformio.ini"),
      "[env:esp32dev]\nplatform = espressif32\n",
    );
    fs.mkdirSync(path.join(tmp, "src"));
    fs.writeFileSync(path.join(tmp, "src", "main.cpp"), "int main(){}\n");

    // Materialize a fake firmware artifact so the cacheReady+firmwarePath
    // branch of `buildContextNextSteps` fires (the tip is gated on both).
    const buildDir = path.join(tmp, ".pio", "build", "esp32dev");
    fs.mkdirSync(buildDir, { recursive: true });
    const fw = path.join(buildDir, "firmware.bin");
    fs.writeFileSync(fw, "FW");

    const lookup = lookupBuildCache(tmp, "esp32dev");
    writeCache(tmp, {
      inputsHash: lookup.inputsHash,
      environment: "esp32dev",
      builtAtMs: Date.now(),
      firmwarePath: fw,
      finalOutputTail: "[SUCCESS]\n",
    });

    const ctx = await getProjectContext(tmp);
    expect(ctx.cacheReady).toBe(true);
    expect(ctx.firmwarePath).toBe(fw);
    expect(
      ctx.nextSteps.some((s) => /cache is warm/i.test(s)),
    ).toBe(true);
  });

  it("never throws on a malformed INI — degrades gracefully", async () => {
    fs.writeFileSync(path.join(tmp, "platformio.ini"), "not really ini @@@@");
    // No src dir.
    const ctx = await getProjectContext(tmp);
    expect(ctx.hasPlatformioIni).toBe(true);
    expect(ctx.environments).toEqual([]);
    expect(ctx.sourceFiles).toEqual([]);
  });
});
