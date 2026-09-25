import { describe, it, expect } from "vitest";
import { parseNumberOption, asString, asBoolean } from "../src/cli/args.js";

describe("parseNumberOption", () => {
  it("parses a plain integer", () => {
    expect(parseNumberOption("42", "lines")).toBe(42);
    expect(parseNumberOption("-5", "offset")).toBe(-5);
  });

  it("is absent when the option was not given", () => {
    expect(parseNumberOption(undefined, "lines")).toBeUndefined();
  });

  it("rejects trailing garbage instead of truncating it", () => {
    // parseInt("12abc") is 12; the doc comment promised garbage is an error.
    expect(() => parseNumberOption("12abc", "lines")).toThrow(
      /must be a number/,
    );
    expect(() => parseNumberOption("abc", "lines")).toThrow(/must be a number/);
    expect(() => parseNumberOption("1.5", "lines")).toThrow(/must be a number/);
  });

  it("rejects a flag given with no value rather than silently defaulting", () => {
    // `--lines` alone parses as boolean true; the user meant to supply one.
    expect(() => parseNumberOption(true, "lines")).toThrow(
      /requires a numeric value/,
    );
  });
});

describe("coercion helpers", () => {
  it("asString never returns a boolean", () => {
    expect(asString(true)).toBeUndefined();
    expect(asString("x")).toBe("x");
  });

  it("asBoolean treats a bare flag as true", () => {
    expect(asBoolean(true)).toBe(true);
    expect(asBoolean(undefined)).toBeFalsy();
  });
});
