/** Real hardware-free dependency build acceptance through the MCP stdio server. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { MCPTestHarness } from "../tests/setup.js";
const [fixtureArg, output] = process.argv.slice(2);
assert(
  fixtureArg && output,
  "Usage: verify-dependency-mcp.ts FIXTURE OUTPUT_JSON",
);
const projectDir = await fs.realpath(fixtureArg);
const root = path.resolve(".platformio-mcp/dependency-acceptance");
await fs.mkdir(root, { recursive: true });
const run = await fs.mkdtemp(path.join(root, "run-"));
const policy = path.join(run, "build-policy.json");
await fs.writeFile(policy, JSON.stringify({ profile: "build_only" }));
process.env.PIO_MCP_POLICY_FILE = policy;
process.env.PIO_MCP_DATA_DIR = path.join(run, "state");
process.env.PIO_MCP_DISABLE_DASHBOARD = "true";
process.env.PIO_MCP_COMPAT = "platformio-mcp-python";
const harness = new MCPTestHarness();
try {
  await harness.connect();
  const response = await harness.client.callTool(
    {
      name: "deps_check",
      arguments: { projectDir, environment: "analysis-esp32s3", build: true },
    },
    undefined,
    { timeout: 660000 },
  );
  const data = (response.structuredContent as any)?.data;
  assert(!response.isError, JSON.stringify(response));
  assert(data?.build?.ok, JSON.stringify(data));
  assert.equal(data.inventoryTiming, "before_build");
  assert.equal(data.graphStatus, "complete");
  const compatibility = await harness.client.callTool(
    {
      name: "pio_deps_check",
      arguments: {
        project_dir: projectDir,
        env: "analysis-esp32s3",
        build: false,
      },
    },
    undefined,
    { timeout: 660000 },
  );
  assert(!compatibility.isError, JSON.stringify(compatibility));
  const compact = compatibility.structuredContent as any;
  assert.equal(compact.env, "analysis-esp32s3");
  assert.equal(compact.build, null);
  const evidence = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    host: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    transport: "MCP stdio",
    toolCount: (await harness.client.listTools()).tools.length,
    checks: {
      canonicalBuildSucceeded: data.build.ok,
      compatibilityInspectionSucceeded: compact.ok,
      inventoryTiming: data.inventoryTiming,
    },
    graphStatus: data.graphStatus,
    graph: data.graph,
    inventoryComplete: data.inventoryComplete,
    counts: data.counts,
    build: data.build,
    physicalDeviceTest: false,
  };
  await fs.writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(
    JSON.stringify({
      graphStatus: evidence.graphStatus,
      buildOk: data.build.ok,
      inventoryComplete: data.inventoryComplete,
      compatibilityOk: compact.ok,
    }),
  );
} finally {
  await harness.disconnect();
}
