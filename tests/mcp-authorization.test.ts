/** Real stdio MCP authorization smoke test; no build, upload or device access is executed. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MCPTestHarness } from "./setup.js";

let harness: MCPTestHarness;
let project: string;
beforeAll(async () => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "pio-mcp-authorization-"));
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { audit_all_agent_actions: false },
    }),
  );
  vi.stubEnv("PIO_MCP_DISABLE_DASHBOARD", "true");
  harness = new MCPTestHarness();
  await harness.connect();
}, 15_000);
afterAll(async () => {
  await harness?.disconnect();
  vi.unstubAllEnvs();
  if (project) fs.rmSync(project, { recursive: true, force: true });
}, 10_000);

/** Recursively preserve old input contracts while allowing new optional properties. */
function preservesSchema(actual: any, baseline: any, location: string): void {
  if (Array.isArray(baseline)) {
    expect(actual, location).toEqual(baseline);
    return;
  }
  if (baseline === null || typeof baseline !== "object") {
    expect(actual, location).toEqual(baseline);
    return;
  }
  expect(actual, location).toBeTypeOf("object");
  if (baseline.type === "object")
    expect(actual.required ?? [], `${location}.required`).toEqual(
      baseline.required ?? [],
    );
  for (const constraint of [
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "minItems",
    "maxItems",
    "uniqueItems",
    "additionalProperties",
    "const",
    "not",
    "allOf",
    "anyOf",
    "oneOf",
    "dependencies",
    "dependentRequired",
  ]) {
    if (!(constraint in baseline))
      expect(actual[constraint], `${location}.${constraint}`).toBeUndefined();
  }
  for (const [key, value] of Object.entries(baseline)) {
    if (key === "description") continue;
    if (key === "enum") {
      expect(actual.enum, `${location}.enum`).toEqual(
        expect.arrayContaining(value as unknown[]),
      );
      continue;
    }
    preservesSchema(actual[key], value, `${location}.${key}`);
  }
}

describe("stdio MCP policy boundary", () => {
  it("keeps all 42 existing tool declarations available", async () => {
    const listed = await harness.client.listTools();
    expect(listed.tools).toHaveLength(44);
  });
  it("preserves every pinned upstream tool input contract", async () => {
    const baseline = JSON.parse(
      fs.readFileSync(
        path.join(
          process.cwd(),
          "docs/reviews/platformio-product-contracts.json",
        ),
        "utf8",
      ),
    );
    expect(baseline.revision).toBe("40e12ccb8e85fcaf33b46c50b6d832665728e773");
    expect(baseline.tools).toHaveLength(42);
    const actual = new Map(
      (await harness.client.listTools()).tools.map((tool) => [tool.name, tool]),
    );
    for (const original of baseline.tools) {
      const tool = actual.get(original.name);
      expect(tool, original.name).toBeDefined();
      preservesSchema(tool!.inputSchema, original.inputSchema, original.name);
    }
  });
  it("lists analysis as build-capable and denies it under read-only policy", async () => {
    const listed = await harness.client.listTools();
    for (const name of ["decode_backtrace", "size_report"]) {
      expect(
        listed.tools.find((tool) => tool.name === name)?.annotations
          ?.readOnlyHint,
      ).toBe(false);
      const response = await harness.client.callTool({
        name,
        arguments: {
          projectDir: project,
          environment: "fixture",
          ...(name === "decode_backtrace" ? { text: "PC: 0x08001234" } : {}),
        },
      });
      expect(response.isError).toBe(true);
      expect(JSON.stringify(response)).toContain("POLICY_DENIED");
    }
  });
  it("returns a denied result before creating a workspace execution ledger", async () => {
    const result = await harness.client.callTool({
      name: "build_project",
      arguments: { projectDir: project },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("deny");
    expect(
      fs.existsSync(
        path.join(
          project,
          ".pio-mcp-workspace",
          "registry",
          "command_history.json",
        ),
      ),
    ).toBe(false);
  });
});
