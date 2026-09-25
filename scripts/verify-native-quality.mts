/** Real native PlatformIO test/static-analysis report acceptance through MCP; no physical device. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { MCPTestHarness } from "../tests/setup.js";
const output = process.argv[2];
assert(output, "Specify evidence output");
const projectDir = path.resolve("tests/fixtures/quality/native");
const state = fs.mkdtempSync(path.join(os.tmpdir(), "pio-native-quality-"));
process.env.PIO_MCP_COMPAT = "platformio-mcp-python";
process.env.PIO_MCP_DATA_DIR = state;
process.env.PIO_MCP_DISABLE_DASHBOARD = "true";
process.env.PIO_MCP_NO_BROWSER = "true";
const harness = new MCPTestHarness();
/** Retain real public responses, including an intentionally failing test case. */
async function call(name: string, args: Record<string, unknown>, expectedFailure?: boolean) {
  const result = await harness.client.callTool({name, arguments: args}, undefined, {timeout: 600000});
  if (expectedFailure !== undefined) assert.equal(result.isError === true, expectedFailure, JSON.stringify(result));
  const structured = result.structuredContent as any;
  if (structured?.data) return structured.data;
  const text = (result.content as any[]).find(item => item.type === "text")?.text;
  return JSON.parse(text);
}
try {
  await harness.connect();
  const passed = await call("pio_test", {project_dir: projectDir, env: "native-pass", without_uploading: true});
  assert.equal(passed.ok, true, JSON.stringify(passed));
  assert.equal(passed.total, 1, JSON.stringify(passed));
  const failed = await call("pio_test", {project_dir: projectDir, env: "native-fail", without_uploading: true}, true);
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(failed.failed, 1, JSON.stringify(failed));
  const checked = await call("pio_check", {project_dir: projectDir, env: "native-pass", severity: "low"});
  assert(checked.defect_count > 0, JSON.stringify(checked));
  assert(checked.defects.some((item: any) => /values|bounds|index/i.test(item.message)), JSON.stringify(checked));
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, JSON.stringify({sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {encoding: "utf8"}).trim(), timestamp: new Date().toISOString(), outcome: "pass", physicalDeviceTest: false, procedure: "Real MCP pio_test passing/failing native Unity fixtures and pio_check cppcheck defect", host: {platform: process.platform, arch: process.arch}, observations: {passed, failed, checked}}, null, 2) + "\n");
  console.log("Real native passing/failing tests and static-analysis defect verified.");
} finally { await harness.disconnect(); }
