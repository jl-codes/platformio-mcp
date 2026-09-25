/** GNU size/nm fixtures validate accounting and source attribution boundaries. */
import { describe, expect, it } from "vitest";
import {
  groupSymbolsByFile,
  parseNm,
  parseSizeSections,
  parseSizeTotals,
} from "../src/core/analysis/size-parser.js";

describe("firmware size analysis", () => {
  it("retains flash mapped at address zero while excluding debug sections", () => {
    const rows = parseSizeSections(
      "section size addr\n.text 1024 0\n.data 32 536870912\n.bss 128 536870944\n.debug_info 9000 0\n.rodata 64 134218752\nTotal 10348\n",
    );
    expect(rows.map((row) => [row.section, row.region])).toEqual([
      [".text", "flash"],
      [".bss", "ram"],
      [".rodata", "flash"],
      [".data", "both"],
    ]);
    expect(rows[0].address).toBe("0x00000000");
  });
  it("distinguishes initialized RAM and static-only RAM in Berkeley totals", () => {
    expect(
      parseSizeTotals(
        "text data bss dec hex filename\n1024 32 128 1184 4a0 firmware.elf\n",
      ),
    ).toEqual({
      text: 1024,
      data: 32,
      bss: 128,
      flashEstimate: 1056,
      ramEstimate: 160,
    });
    expect(parseSizeTotals("no totals available")).toBeNull();
    expect(() => parseSizeTotals("1 2 3 99 63 bad.elf")).toThrow(
      "Inconsistent",
    );
    expect(() => parseSizeTotals("1 2 3 6 6 a.elf\n1 2 3 6 6 b.elf")).toThrow(
      "exactly one",
    );
  });
  it("preserves demangled names, Unicode paths and unknown source attribution", () => {
    const rows = parseNm(
      "08000100 00000020 T Widget::run(int)\tC:/firmware/測試/main.cpp:12\n20000000 00000040 B scratch\n08000200 00000000 T empty\n",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "scratch",
      size: 64,
      kind: "bss",
      file: null,
      line: null,
    });
    expect(rows[1]).toMatchObject({
      name: "Widget::run(int)",
      file: "C:/firmware/測試/main.cpp",
      line: 12,
    });
  });
  it("does not shorten a sibling directory that shares the project prefix", () => {
    const symbols = parseNm(
      "08000100 10 T first\t/project/src/main.cpp:1\n08000200 20 T second\t/project-other/main.cpp:2",
    );
    expect(
      groupSymbolsByFile(symbols, "/project").map((row) => row.file),
    ).toEqual(["/project-other/main.cpp", "src/main.cpp"]);
  });
  it("does not round huge symbol sizes or silently truncate oversized output", () => {
    expect(() => parseNm("08000100 20000000000001 T too_large")).toThrow(
      "exact numeric",
    );
    expect(() => parseSizeSections("x".repeat(16_385))).toThrow("line limits");
  });
});
