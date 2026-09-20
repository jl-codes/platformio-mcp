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
    // Property names are data, even when named after JSON Schema keywords.
    if (["properties", "$defs", "definitions"].includes(key)) {
      expect(actual[key], `${location}.${key}`).toBeTypeOf("object");
      for (const [name, schema] of Object.entries(value as Record<string, unknown>)) {
        preservesSchema(actual[key][name], schema, `${location}.${key}.${name}`);
      }
      continue;
    }
    preservesSchema(actual[key], value, `${location}.${key}`);
  }
}

describe("schema compatibility comparator", () => {
  it("allows optional properties named after schema keywords", () => {
    const baseline = { type: "object", properties: { description: { type: "string" } } };
    const actual = {
      ...baseline,
      properties: { ...baseline.properties, pattern: { type: "string", minLength: 1 } },
    };
    expect(() => preservesSchema(actual, baseline, "tool")).not.toThrow();
    expect(() => preservesSchema({ ...actual, required: ["pattern"] }, baseline, "tool")).toThrow();
    expect(() => preservesSchema({
      ...actual,
      properties: { ...actual.properties, description: { type: "number" } },
    }, baseline, "tool")).toThrow();
  });
  it("rejects new constraints on existing input properties", () => {
    const baseline = { type: "object", properties: { name: { type: "string" } } };
    const actual = { type: "object", properties: { name: { type: "string", pattern: "^[a-z]+$" } } };
    expect(() => preservesSchema(actual, baseline, "tool")).toThrow();
  });
});

describe("stdio MCP policy boundary", () => {
  it("keeps all 42 existing tool declarations available", async () => {
    const listed = await harness.client.listTools();
    expect(listed.tools).toHaveLength(54);
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
  it("registers all modern package operations and denies project effects under read-only policy", async () => {
    const listed = await harness.client.listTools();
    for (const name of [
      "pkg_install",
      "pkg_uninstall",
      "pkg_update",
      "pkg_list",
      "pkg_outdated",
    ]) {
      expect(
        listed.tools.find((tool) => tool.name === name)?.annotations
          ?.readOnlyHint,
      ).toBe(false);
      const response = await harness.client.callTool({
        name,
        arguments: {
          projectDir: project,
          environment: "fixture",
          ...(name === "pkg_install" || name === "pkg_uninstall"
            ? { spec: "owner/fixture@1" }
            : {}),
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

it("marks configuration as inspection and denies metadata/target scripts through MCP", async () => {
  const listed = await harness.client.listTools();
  expect(
    listed.tools.find((tool) => tool.name === "project_envs")?.annotations
      ?.readOnlyHint,
  ).toBe(true);
  for (const name of ["project_metadata", "list_targets"]) {
    expect(
      listed.tools.find((tool) => tool.name === name)?.annotations
        ?.readOnlyHint,
    ).toBe(false);
    const response = await harness.client.callTool({
      name,
      arguments: { projectDir: project },
    });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response)).toContain("POLICY_DENIED");
  }
});
