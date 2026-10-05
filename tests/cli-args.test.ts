import { describe, it, expect } from "vitest";
import {
  parseNumberOption,
  asNumber,
  asString,
  asBoolean,
  validateNumericCommandOptions,
} from "../src/cli/args.js";
import type { OptionValue } from "../src/cli/commands/types.js";

describe("asNumber", () => {
  it.each([
    ["42", 42],
    ["-5", -5],
    ["1.5", 1.5],
    [".5", 0.5],
    ["1e2", 100],
    ["0x20", 32],
    [" 3 ", 3],
  ])("preserves the supported finite form %s", (raw, expected) => {
    expect(asNumber(raw, "timeout")).toBe(expected);
  });

  it("leaves only an absent option undefined", () => {
    expect(asNumber(undefined, "timeout")).toBeUndefined();
  });

  it.each([
    true,
    false,
    "",
    "  ",
    "abc",
    "12abc",
    "NaN",
    "Infinity",
    "-Infinity",
    "1e309",
  ])("rejects present invalid input %j with a named argument error", (raw) => {
    expect(() => asNumber(raw, "timeout")).toThrowError(
      expect.objectContaining({
        code: "INVALID_ARGUMENT",
        context: expect.objectContaining({ argument: "timeout" }),
        message: expect.stringContaining("--timeout"),
      }),
    );
  });
});

describe("numeric command preflight", () => {
  const schemaFields = [
    ["build", "jobs", "1024", "1025", "1.5"],
    ["monitor-health", "baud-rate", "2000000", "2000001", "1.5"],
    ["monitor-health", "duration", "60", "61", "1.5"],
    ["monitor-health", "max-bytes", "65536", "65537", "256.5"],
    ["monitor-health", "failure-threshold", "10", "11", "1.5"],
    ["target-resolve", "binding-ttl", "900", "901", "30.5"],
    ["agent-flash-monitor-verify", "timeout", "300", "301", "1.5"],
    ["agent-flash-monitor-verify", "stability-window", "120", "121", "1.5"],
    ["pending-approvals", "limit", "100", "101", "1.5"],
    ["task-history", "limit", "100", "101", "1.5"],
  ];

  it.each(schemaFields)(
    "keeps the existing %s --%s field contract",
    (command, name, maximum, oversized, fraction) => {
      expect(() => validateNumericCommandOptions(command, {})).not.toThrow();
      expect(() =>
        validateNumericCommandOptions(command, { [name]: maximum }),
      ).not.toThrow();
      for (const value of [
        true,
        "",
        "bogus",
        "Infinity",
        "0",
        "-1",
        oversized,
        fraction,
      ]) {
        expect(() =>
          validateNumericCommandOptions(command, { [name]: value }),
        ).toThrowError(
          expect.objectContaining({
            code: "INVALID_ARGUMENT",
            context: expect.objectContaining({ argument: name }),
          }),
        );
      }
    },
  );

  it("preserves finite fractions, exponents, and raw authorization arguments", () => {
    const options: Record<string, OptionValue> = {
      timeout: "1.5",
      port: "COM8",
      background: "yes",
    };
    validateNumericCommandOptions("monitor", options);
    expect(options).toEqual({
      timeout: "1.5",
      port: "COM8",
      background: "yes",
    });
    expect(() =>
      validateNumericCommandOptions("monitor", { timeout: "1e-2" }),
    ).not.toThrow();
    expect(() =>
      validateNumericCommandOptions("approvals", { limit: "1.5" }),
    ).not.toThrow();
    expect(() =>
      validateNumericCommandOptions("build", { jobs: "1e2" }),
    ).not.toThrow();
  });

  it("retains integer-only strict parsers without policing unused flags", () => {
    expect(() =>
      validateNumericCommandOptions("logs", { lines: "1e2" }, ["query"]),
    ).toThrowError(/--lines/);
    expect(() =>
      validateNumericCommandOptions("logs", { duration: "1.5" }, ["capture"]),
    ).toThrowError(/--duration/);
    expect(() =>
      validateNumericCommandOptions("lib", { limit: "1.5" }, [
        "search",
        "sensor",
      ]),
    ).toThrowError(/--limit/);
    expect(() =>
      validateNumericCommandOptions("dashboard", { port: "abc", serve: true }),
    ).toThrowError(/--port/);
    expect(() =>
      validateNumericCommandOptions("dashboard", { port: "0", serve: true }),
    ).not.toThrow();
    expect(() =>
      validateNumericCommandOptions("dashboard", { port: "abc" }),
    ).not.toThrow();
    expect(() =>
      validateNumericCommandOptions("logs", { duration: "abc" }, ["query"]),
    ).not.toThrow();
    expect(() =>
      validateNumericCommandOptions("lib", { limit: "abc" }, ["list"]),
    ).not.toThrow();
    expect(() =>
      validateNumericCommandOptions("flash", { port: "COM8" }),
    ).not.toThrow();
  });
});

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
