/** Compatibility opt-in parsing never changes permission configuration. */
import { expect, it } from "vitest";
import { parseCompatibilityLaunch } from "../src/adapters/compatibility-mode.js";
it("leaves normal startup disabled and preserves unrelated arguments", () => {
  expect(
    parseCompatibilityLaunch(["--policy-file", "policy.json"], undefined),
  ).toEqual({ mode: undefined, args: ["--policy-file", "policy.json"] });
});
it.each([
  ["--compat", "platformio-mcp-python"],
  ["--compat=platformio-mcp-python"],
])("accepts an explicit pinned mode", (...args) => {
  expect(parseCompatibilityLaunch(args, undefined)).toEqual({
    mode: "platformio-mcp-python",
    args: [],
  });
});
it("supports a launch environment and matching flag", () => {
  expect(parseCompatibilityLaunch(["serve"], "platformio-mcp-python")).toEqual({
    mode: "platformio-mcp-python",
    args: ["serve"],
  });
  expect(
    parseCompatibilityLaunch(
      ["--compat=platformio-mcp-python"],
      "platformio-mcp-python",
    ).mode,
  ).toBe("platformio-mcp-python");
});
it.each([
  ["--compat"],
  ["--compat="],
  ["--compat", "--help"],
  ["--compat=unknown"],
  ["--compat=platformio-mcp-python", "--compat=platformio-mcp-python"],
])("rejects invalid or duplicate selection", (...args) => {
  expect(() => parseCompatibilityLaunch(args, undefined)).toThrow(
    expect.objectContaining({ code: "COMPAT_CONFIG_INVALID" }),
  );
});
it("does not reinterpret positional arguments after the delimiter", () => {
  expect(
    parseCompatibilityLaunch(["--", "--compat=unknown"], undefined),
  ).toEqual({ mode: undefined, args: ["--", "--compat=unknown"] });
  expect(() => parseCompatibilityLaunch([], "")).toThrow();
});
