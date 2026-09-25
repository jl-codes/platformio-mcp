/** Live MCP verification for resolved configuration, metadata and structured target discovery. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { MCPTestHarness } from "../tests/setup.js";
const [fixtureArg, output] = process.argv.slice(2);
assert(
  fixtureArg && output,
  "Usage: node --import tsx scripts/verify-project-inspection-mcp.ts ESP32_FIXTURE OUTPUT_JSON",
);
const fixture = await fs.realpath(fixtureArg);
const root = path.resolve(".platformio-mcp/project-inspection-acceptance");
await fs.mkdir(root, { recursive: true });
const projectDir = await fs.mkdtemp(path.join(root, "run-"));
await fs.writeFile(
  path.join(projectDir, "platformio.ini"),
  `[platformio]
default_envs = right
extra_configs = extra.ini
[common]
board = esp32dev
framework = arduino
monitor_speed = 57600
[base]
extends = common
platform = espressif32@7.0.1
[env]
build_flags = -DFIXTURE
[env:left]
extends = base
[env:right]
extends = common, base
board = esp32-s3-devkitc-1
`,
);
await fs.writeFile(
  path.join(projectDir, "extra.ini"),
  `[extra-base]
upload_protocol = esptool
monitor_port = COM23
[env:extra]
extends = base, extra-base
`,
);
await fs.writeFile(
  path.join(projectDir, ".pio-mcp-policy.json"),
  '{"profile":"read_only"}',
);
process.env.PIO_MCP_DISABLE_DASHBOARD = "true";
process.env.PIO_MCP_DATA_DIR = path.join(root, "operator");
const harness = new MCPTestHarness();
async function call(name: string, args: Record<string, unknown>) {
  const response = await harness.client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: 660000 },
  );
  assert(!response.isError, JSON.stringify(response));
  const data = (response.structuredContent as any).data;
  assert(data.ok, JSON.stringify(data));
  console.log(`${name}: passed`);
  return data;
}
try {
  await harness.connect();
  const config = await call("project_envs", { projectDir });
  assert.deepEqual(config.defaultEnvironments, ["right"]);
  const left = config.envs.find((env: any) => env.name === "left");
  const right = config.envs.find((env: any) => env.name === "right");
  const extra = config.envs.find((env: any) => env.name === "extra");
  assert.equal(left.board, "esp32dev");
  assert.equal(left.platform, "espressif32@7.0.1");
  assert.equal(left.monitorSpeed, 57600);
  assert.deepEqual(left.framework, ["arduino"]);
  assert.equal(right.board, "esp32-s3-devkitc-1");
  assert.equal(right.monitorSpeed, 57600);
  assert.equal(extra.uploadProtocol, "esptool");
  assert.equal(extra.monitorPort, "COM23");
  assert.deepEqual(extra.buildFlags, ["-DFIXTURE"]);
  const denied = await harness.client.callTool({
    name: "project_metadata",
    arguments: { projectDir },
  });
  assert(denied.isError);
  assert(JSON.stringify(denied).includes("POLICY_DENIED"));
  const metadata = await call("project_metadata", {
    projectDir: fixture,
    environment: "analysis-esp32s3",
  });
  const selected = metadata.envs["analysis-esp32s3"];
  assert(path.isAbsolute(selected.cc));
  assert(path.isAbsolute(selected.programPath));
  assert(selected.defines.length > 0 && selected.includeDirCount > 0);
  assert(selected.extra.flash_images.length > 0);
  const targets = await call("list_targets", {
    projectDir: fixture,
    environment: "analysis-esp32s3",
  });
  assert(targets.targets.some((target: any) => target.name === "size"));
  assert(targets.targets.some((target: any) => target.name === "upload"));
  assert(
    targets.targets.every(
      (target: any) => target.environment === "analysis-esp32s3",
    ),
  );
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
      nestedInheritance: true,
      multipleBases: true,
      commonEnvironment: true,
      extraConfiguration: true,
      nonFirstDefault: true,
      readOnlyConfiguration: true,
      readOnlyMetadataDenied: true,
      liveBuildMetadata: true,
      structuredTargets: true,
    },
    metadata: {
      environment: "analysis-esp32s3",
      defines: selected.defines.length,
      includeDirectories: selected.includeDirCount,
      targetNames: targets.targets.map((target: any) => target.name),
    },
    physicalDeviceTest: false,
  };
  await fs.writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
} finally {
  await harness.disconnect();
}
