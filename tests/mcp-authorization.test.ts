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

describe("stdio MCP policy boundary", () => {
  it("keeps all 42 existing tool declarations available", async () => {
    const listed = await harness.client.listTools();
    expect(listed.tools).toHaveLength(42);
  });
  it("returns a denied result before creating a workspace execution ledger", async () => {
    const result = await harness.client.callTool({
      name: "build_project",
      arguments: { projectDir: project },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("deny");
    expect(fs.readdirSync(project)).toEqual([".pio-mcp-policy.json"]);
  });
});
