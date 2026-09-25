/** Exact environment selection and malformed metadata rejection. */
import path from "node:path";
import { describe, it, expect } from "vitest";
import { selectBuildMetadata } from "../src/core/analysis/build-metadata.js";
const compiler = path.resolve("fixture/bin/arm-none-eabi-gcc");
const elf = path.resolve("fixture/build/firmware.elf");
const entry = { cc_path: compiler, prog_path: elf, unrelated: { debug: true } };
describe("build metadata selection", () => {
  it("selects the requested environment instead of object order", () => {
    const result = selectBuildMetadata(
      JSON.stringify({
        first: { ...entry, prog_path: path.resolve("wrong.elf") },
        selected: entry,
      }),
      "selected",
    );
    expect(result).toEqual({
      environment: "selected",
      compilerPath: compiler,
      elfPath: elf,
    });
  });
  it("selects an unambiguous single environment", () =>
    expect(
      selectBuildMetadata(JSON.stringify({ only: entry })).environment,
    ).toBe("only"));
  it("rejects ambiguous or missing environment selection", () => {
    expect(() =>
      selectBuildMetadata(JSON.stringify({ one: entry, two: entry })),
    ).toThrow("explicit environment");
    expect(() =>
      selectBuildMetadata(JSON.stringify({ one: entry }), "two"),
    ).toThrow("absent");
    expect(() =>
      selectBuildMetadata(JSON.stringify({ one: entry }), "toString"),
    ).toThrow("absent");
  });
  it.each([
    "null",
    "[]",
    "{}",
    "warning before json {}",
    JSON.stringify({ one: null }),
  ])("rejects invalid metadata %s", (output) =>
    expect(() => selectBuildMetadata(output)).toThrow(),
  );
  it.each(["", "relative/file", "bad\u0000path", 42, null])(
    "rejects invalid compiler and ELF paths %s",
    (value) => {
      expect(() =>
        selectBuildMetadata(
          JSON.stringify({ one: { ...entry, cc_path: value } }),
        ),
      ).toThrow();
      expect(() =>
        selectBuildMetadata(
          JSON.stringify({ one: { ...entry, prog_path: value } }),
        ),
      ).toThrow();
    },
  );
  it("rejects oversized output", () =>
    expect(() => selectBuildMetadata(" ".repeat(10 * 1024 * 1024 + 1))).toThrow(
      "10 MiB",
    ));
});
