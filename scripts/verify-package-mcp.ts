/** Real MCP package acceptance using repository-owned local packages and an isolated PlatformIO core. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { MCPTestHarness } from "../tests/setup.js";
const [output] = process.argv.slice(2);
assert(
  output,
  "Usage: node --import tsx scripts/verify-package-mcp.ts OUTPUT_JSON",
);
const base = path.resolve(".platformio-mcp/package-acceptance");
await fs.mkdir(base, { recursive: true });
const root = await fs.mkdtemp(path.join(base, "run-"));
const projectDir = path.join(root, "project");
const platform = path.join(root, "platform");
const library = path.join(root, "library");
const tool = path.join(root, "tool");
for (const dir of [projectDir, platform, library, tool]) await fs.mkdir(dir);
await fs.writeFile(
  path.join(platform, "platform.json"),
  JSON.stringify({
    name: "packageparity",
    version: "1.0.0",
    title: "Local MCP package fixture",
    description: "No hardware or build scripts",
    license: "MIT",
    engines: { platformio: ">=6" },
    packages: {
      "tool-package-parity": {
        type: "toolchain",
        optional: true,
        version: `file://${tool.replaceAll("\\", "/")}`,
      },
    },
    frameworks: {},
  }),
);
await fs.writeFile(
  path.join(library, "library.json"),
  JSON.stringify({
    name: "MCP Package Fixture",
    version: "1.0.0",
    description: "Local acceptance package",
  }),
);
await fs.writeFile(path.join(library, "fixture.h"), "#pragma once\n");
await fs.writeFile(
  path.join(tool, "package.json"),
  JSON.stringify({
    name: "tool-package-parity",
    version: "1.0.0",
    description: "Local data-only acceptance tool",
  }),
);
const specification = (file: string) => `file://${file.replaceAll("\\", "/")}`;
const platformSpec = specification(platform);
const ini = `; package acceptance comment\n[env:fixture]\nplatform = ${platformSpec}\nmonitor_speed = 115200 ; keep this comment\n\n[env:untouched]\nplatform = ${platformSpec}\ncustom_marker = leave-this-alone\n`;
await fs.writeFile(path.join(projectDir, "platformio.ini"), ini);
process.env.PIO_MCP_DISABLE_DASHBOARD = "true";
process.env.PIO_MCP_DATA_DIR = path.join(root, "operator");
process.env.PLATFORMIO_CORE_DIR = path.join(root, "pio-core");
const harness = new MCPTestHarness();
const checks: Record<string, unknown> = {};
async function call(name: string, args: Record<string, unknown>) {
  const result = await harness.client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: 960000 },
  );
  assert(!result.isError, JSON.stringify(result));
  const data = (result.structuredContent as any).data;
  assert.equal(data.ok, true, JSON.stringify(data));
  console.log(`${name}: passed`);
  return data;
}
try {
  await harness.connect();
  const listed = await harness.client.listTools();
  const scope = { projectDir, environment: "fixture" };
  await call("pkg_install", { ...scope, kind: "platform", spec: platformSpec });
  await call("pkg_install", {
    ...scope,
    kind: "tool",
    spec: specification(tool),
  });
  const installed = await call("pkg_install", {
    ...scope,
    spec: specification(library),
  });
  assert.equal(installed.configuration.changed, true);
  const persisted = await fs.readFile(
    path.join(projectDir, "platformio.ini"),
    "utf8",
  );
  assert(persisted.includes("; package acceptance comment"));
  assert(persisted.includes("monitor_speed = 115200 ; keep this comment"));
  assert(persisted.includes(ini.slice(ini.indexOf("[env:untouched]"))));
  checks.installedAllThreeKinds = true;
  checks.commentsAndUntouchedEnvironmentPreserved = true;
  const packages = await call("pkg_list", scope);
  assert(
    packages.packages.some(
      (row: any) =>
        row.name === "MCP Package Fixture" &&
        row.kind === "library" &&
        row.version === "1.0.0",
    ),
  );
  assert(
    packages.packages.some(
      (row: any) => row.name === "tool-package-parity" && row.kind === "tool",
    ),
  );
  checks.listParsed = packages.packages.length;
  await call("pkg_outdated", scope);
  await call("pkg_update", scope);
  checks.outdatedAndUpdate = true;
  await call("pkg_uninstall", { ...scope, spec: specification(library) });
  const removed = await call("pkg_list", scope);
  assert(
    !removed.packages.some((row: any) => row.name === "MCP Package Fixture"),
  );
  assert(
    !(
      await fs.readFile(path.join(projectDir, "platformio.ini"), "utf8")
    ).includes("lib_deps"),
  );
  checks.uninstallPersisted = true;
  const search = await call("pkg_search", {
    query: "ArduinoJson",
    kind: "library",
    page: 1,
  });
  assert(search.total > 0 && search.packages.some((row: any) => row.spec));
  checks.registrySearch = {
    total: search.total,
    page: search.page,
    returned: search.packages.length,
  };
  const evidence = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    host: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    transport: "MCP stdio",
    toolCount: listed.tools.length,
    isolatedPlatformioCore: true,
    checks,
    physicalDeviceTest: false,
  };
  await fs.writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
} finally {
  await harness.disconnect();
}
