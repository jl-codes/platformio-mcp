/** Launch policy selection must not silently redirect authority. */
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
async function sources() {
  vi.stubEnv("PIO_MCP_POLICY_FILE", undefined);
  return import("../src/core/policy/policy-sources.js");
}

describe("policy launch source selection", () => {
  it.each([
    ["--policy-file", "operator.yaml", "policy-status", "--json"],
    ["policy-status", "--policy-file=operator.yaml", "--json"],
  ])("removes launch selectors before routing: %s", async (...args) => {
    const module = await sources();
    expect(module.configurePolicyFileFromArgs(args)).toEqual([
      "policy-status",
      "--json",
    ]);
    expect(module.resolvePolicyFile()).toBe(path.resolve("operator.yaml"));
  });
  it("rejects conflicting selectors and accepts equivalent paths", async () => {
    const module = await sources();
    vi.stubEnv("PIO_MCP_POLICY_FILE", "operator.yaml");
    expect(() =>
      module.configurePolicyFileFromArgs(["--policy-file", "other.yaml"]),
    ).toThrow("Conflicting");
    module.configurePolicyFileFromArgs([
      "--policy-file",
      path.resolve("operator.yaml"),
    ]);
    expect(module.resolvePolicyFile()).toBe(path.resolve("operator.yaml"));
  });
  it.each([
    ["--policy-file"],
    ["--policy-file="],
    ["--policy-file", "--json"],
    ["--policy-file=a.yaml", "--policy-file=b.yaml"],
  ])("rejects invalid launch selection %s", async (...args) => {
    const module = await sources();
    expect(() => module.configurePolicyFileFromArgs(args)).toThrow();
  });
  it("never falls back after an explicitly empty source", async () => {
    const module = await sources();
    vi.stubEnv("PIO_MCP_POLICY_FILE", " ");
    expect(() => module.resolvePolicyFile()).toThrow("empty");
    vi.stubEnv("PIO_MCP_DATA_DIR", "");
    expect(() => module.resolvePolicyDirectory()).toThrow("empty");
  });
});
