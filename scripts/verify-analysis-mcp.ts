/** End-to-end analysis acceptance over MCP against the repository-owned built ESP32-S3 fixture. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { MCPTestHarness } from "../tests/setup.js";
const [projectArg, output] = process.argv.slice(2);
assert(
  projectArg && output,
  "Usage: node --import tsx scripts/verify-analysis-mcp.ts FIXTURE_PROJECT OUTPUT_JSON",
);
const projectDir = await fs.realpath(projectArg);
process.env.PIO_MCP_DISABLE_DASHBOARD = "true";
process.env.PIO_MCP_DATA_DIR = path.resolve(
  ".platformio-mcp/analysis-mcp-acceptance",
);
const harness = new MCPTestHarness();
try {
  await harness.connect();
  const tools = await harness.client.listTools();
  assert(tools.tools.some((tool) => tool.name === "size_report"));
  const config = await harness.client.callTool(
    { name: "get_project_config", arguments: { projectDir } },
    undefined,
    { timeout: 60000 },
  );
  assert(!config.isError, "Fixture configuration must be readable");
  const sizeResult = await harness.client.callTool(
    {
      name: "size_report",
      arguments: {
        projectDir,
        environment: "analysis-esp32s3",
        filter: "^fixture_add",
        top: 25,
      },
    },
    undefined,
    { timeout: 660000 },
  );
  assert(!sizeResult.isError, JSON.stringify(sizeResult));
  const size = (sizeResult.structuredContent as any).data;
  assert.equal(size.memorySource, "platformio");
  assert.equal(size.symbolCount, 1);
  assert.equal(size.topSymbols[0].name, "fixture_add(unsigned int)");
  const decodedResult = await harness.client.callTool(
    {
      name: "decode_backtrace",
      arguments: {
        projectDir,
        environment: "analysis-esp32s3",
        expectedElfSha256: size.elf.sha256,
        text: `PC: ${size.topSymbols[0].address}`,
      },
    },
    undefined,
    { timeout: 660000 },
  );
  assert(!decodedResult.isError, JSON.stringify(decodedResult));
  const decoded = (decodedResult.structuredContent as any).data;
  assert.equal(decoded.frames[0].resolved, true);
  assert.equal(decoded.frames[0].function, "fixture_add(unsigned int)");
  assert.equal(decoded.elf.sha256, size.elf.sha256);
  assert.equal(decoded.flashedFirmwareVerified, false);
  const evidence = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    host: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    transport: "MCP stdio",
    environment: "analysis-esp32s3",
    toolCount: tools.tools.length,
    elfSha256: size.elf.sha256,
    checks: {
      liveMetadata: true,
      registeredToolchain: true,
      liveSizeCheck: true,
      filteredSymbol: true,
      decodedKnownSource: true,
    },
    memory: size.memory,
    gnuTotals: size.totals,
    sourceLine: decoded.frames[0].line,
    physicalDeviceTest: false,
  };
  await fs.writeFile(output, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await harness.disconnect();
}
