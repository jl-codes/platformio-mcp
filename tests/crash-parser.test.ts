/** Crash parser fixtures cover target-specific registers and GNU symbol text. */
import { describe, expect, it } from "vitest";
import {
  extractCrash,
  normalizeAddress,
  parseAddr2line,
} from "../src/core/analysis/crash-parser.js";

describe("crash evidence extraction", () => {
  it("extracts Xtensa code addresses without treating stack pointers as call frames", () => {
    const result = extractCrash(
      "Guru Meditation Error: Core 0 panic'ed (LoadProhibited).\nPC : 0x400d1234 A0 : 0x800d5678 EXCVADDR: 0x00000000\nBacktrace: 0x400d1234:0x3ffb1000 0x400d5678:0x3ffb1020 |<-CORRUPTED\nrst:0xc (SW_CPU_RESET)",
    );
    expect(result.backtraceCorrupted).toBe(true);
    expect(result.resetReasons).toEqual(["SW_CPU_RESET"]);
    expect(result.addresses).toContainEqual({
      address: "0x400d5678",
      role: "lr",
      register: "A0",
      frame: null,
    });
    expect(
      result.addresses
        .filter((address) => address.role === "backtrace")
        .map((address) => address.address),
    ).toEqual(["0x400d1234", "0x400d5678"]);
    expect(
      result.addresses.some((address) => address.address === "0x3ffb1000"),
    ).toBe(false);
  });
  it("preserves RISC-V RA instead of applying Xtensa window-bit correction", () => {
    const result = extractCrash(
      "MEPC: 0x80001234 RA: 0x80005678 MTVAL: 0x00000004 A0: 0x80008888",
    );
    expect(
      result.addresses.find((address) => address.register === "RA")?.address,
    ).toBe("0x80005678");
  });
  it("retains frame indexes across wrapped backtrace lines", () => {
    const result = extractCrash(
      "Backtrace: 0x400d1234:0x3ffb1000\n  0x400d5678:0x3ffb1020\n|<-CORRUPTED\nnormal output",
    );
    expect(result.backtraceCorrupted).toBe(true);
    expect(result.addresses.map((address) => address.frame)).toEqual([0, 1]);
  });
  it("recognizes Cortex-M PC/LR aliases and leaves fault-register data distinct", () => {
    const result = extractCrash(
      "HardFault\nR15 (PC) = 0x08001235\nR14 (LR) = 0x08004567\nMSP: 0x20001000",
    );
    expect(result.causes).toEqual(["HardFault"]);
    expect(result.addresses.map((address) => address.role)).toEqual([
      "pc",
      "lr",
      "register",
    ]);
  });
  it("supports arbitrary hex fallback and explicit inclusion without inventing frames", () => {
    expect(extractCrash("value 0x12345678").addresses[0].role).toBe("other");
    expect(
      extractCrash("PC: 0x40000001 data: 0x12345678").addresses,
    ).toHaveLength(1);
    expect(
      extractCrash("PC: 0x40000001 data: 0x12345678", true).addresses,
    ).toHaveLength(3);
  });
  it("bounds input without silently discarding late crash evidence", () => {
    expect(() => extractCrash("x".repeat(1024 * 1024 + 1))).toThrow("1 MiB");
    expect(() => extractCrash("x".repeat(16_385))).toThrow("16 KiB");
    expect(normalizeAddress("0xffffffffffffffff")).toBe("0xffffffffffffffff");
    expect(() => normalizeAddress("0x10000000000000000")).toThrow("Invalid");
  });
});

describe("GNU symbol output", () => {
  it("parses Unicode and Windows paths, inlined frames and unknown symbols", () => {
    const result = parseAddr2line(
      "0x400d1234: loop() at C:/firmware/測試/main.cpp:42 (discriminator 2)\n (inlined by) setup() at C:/firmware/init.cpp:12\n0x400d5678: ?? ??:0\n0x80001234: helper() at /home/user/src.c:?\n",
    );
    expect(result.get("0x400d1234")).toMatchObject({
      function: "loop()",
      file: "C:/firmware/測試/main.cpp",
      line: 42,
      resolved: true,
      inlined: [
        { function: "setup()", file: "C:/firmware/init.cpp", line: 12 },
      ],
    });
    expect(result.get("0x400d5678")).toMatchObject({
      function: null,
      line: null,
      resolved: false,
    });
    expect(result.get("0x80001234")?.line).toBeNull();
  });
});
