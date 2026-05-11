/**
 * Tests for build-cache.ts — the content-hash short-circuit added in response
 * to EmbedBench hill-climbing traces. We exercise:
 *
 *   1. computeProjectHash() determinism — identical trees must hash the same.
 *   2. Cache miss → hit → invalidate roundtrip.
 *   3. Hash change when any source file mutates.
 *   4. findFirmwareArtifact() handles missing .pio/build gracefully.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  computeProjectHash,
  lookupBuildCache,
  writeCache,
  invalidateBuildCache,
  findFirmwareArtifact,
  readCache,
} from "../src/utils/build-cache.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "piomcp-cache-"));
  fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "platformio.ini"), "[env:dev]\nplatform = native\n");
  fs.writeFileSync(path.join(tmp, "src", "main.cpp"), "int main(){return 0;}\n");
});

afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
});

describe("build-cache", () => {
  it("computeProjectHash is deterministic and env-sensitive", () => {
    const a = computeProjectHash(tmp, "dev");
    const b = computeProjectHash(tmp, "dev");
    expect(a).toBe(b);
    const c = computeProjectHash(tmp, "other");
    expect(c).not.toBe(a);
  });

  it("hash invalidates when source content changes", () => {
    const before = computeProjectHash(tmp, "dev");
    fs.writeFileSync(path.join(tmp, "src", "main.cpp"), "int main(){return 1;}\n");
    const after = computeProjectHash(tmp, "dev");
    expect(after).not.toBe(before);
  });

  it("lookupBuildCache returns miss on cold cache, hit after writeCache", () => {
    const miss = lookupBuildCache(tmp, "dev");
    expect(miss.hit).toBe(false);
    expect(typeof miss.inputsHash).toBe("string");

    writeCache(tmp, {
      inputsHash: miss.inputsHash,
      environment: "dev",
      builtAtMs: Date.now(),
      finalOutputTail: "[SUCCESS]\n",
    });

    const hit = lookupBuildCache(tmp, "dev");
    expect(hit.hit).toBe(true);
    if (hit.hit) {
      expect(hit.entry.environment).toBe("dev");
      expect(hit.entry.inputsHash).toBe(miss.inputsHash);
    }
  });

  it("source mutation forces a miss against the existing cache", () => {
    const miss = lookupBuildCache(tmp, "dev");
    writeCache(tmp, {
      inputsHash: miss.inputsHash,
      environment: "dev",
      builtAtMs: Date.now(),
      finalOutputTail: "ok",
    });
    expect(lookupBuildCache(tmp, "dev").hit).toBe(true);

    fs.writeFileSync(path.join(tmp, "src", "main.cpp"), "// edited\nint main(){return 0;}\n");
    const after = lookupBuildCache(tmp, "dev");
    expect(after.hit).toBe(false);
  });

  it("invalidateBuildCache removes the cache file", () => {
    const miss = lookupBuildCache(tmp, "dev");
    writeCache(tmp, {
      inputsHash: miss.inputsHash,
      environment: "dev",
      builtAtMs: Date.now(),
      finalOutputTail: "ok",
    });
    expect(readCache(tmp)).not.toBeNull();
    invalidateBuildCache(tmp);
    expect(readCache(tmp)).toBeNull();
    expect(lookupBuildCache(tmp, "dev").hit).toBe(false);
  });

  it("findFirmwareArtifact returns undefined when .pio/build is missing", () => {
    expect(findFirmwareArtifact(tmp, "dev")).toBeUndefined();
  });

  it("findFirmwareArtifact prefers firmware.elf/bin/hex when present", () => {
    const buildDir = path.join(tmp, ".pio", "build", "dev");
    fs.mkdirSync(buildDir, { recursive: true });
    const elf = path.join(buildDir, "firmware.elf");
    fs.writeFileSync(elf, "ELF");
    const found = findFirmwareArtifact(tmp, "dev");
    expect(found).toBeTruthy();
    expect(found!.endsWith("firmware.elf")).toBe(true);
  });

  it("cache hit is invalidated when the recorded firmware artifact disappears", () => {
    // Simulates: build succeeded, cache written referencing firmware.elf, then
    // user (or `clean_project` outside our wrapper) wiped .pio/build.
    const buildDir = path.join(tmp, ".pio", "build", "dev");
    fs.mkdirSync(buildDir, { recursive: true });
    const elf = path.join(buildDir, "firmware.elf");
    fs.writeFileSync(elf, "ELF");

    const miss = lookupBuildCache(tmp, "dev");
    writeCache(tmp, {
      inputsHash: miss.inputsHash,
      environment: "dev",
      builtAtMs: Date.now(),
      firmwarePath: elf,
      finalOutputTail: "ok",
    });
    expect(lookupBuildCache(tmp, "dev").hit).toBe(true);

    fs.rmSync(elf);
    const after = lookupBuildCache(tmp, "dev");
    expect(after.hit).toBe(false);
  });
});
