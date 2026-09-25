/** Partition compatibility retains reference inputs and explicit offline evidence extensions. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { executePartitionCompatibility } from "../src/adapters/partition-compat.js";
let root: string, state: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-partition-compat-"));
  state = fs.mkdtempSync(path.join(os.tmpdir(), "pio-partition-compat-state-"));
  vi.stubEnv("PIO_MCP_DATA_DIR", state);
  fs.writeFileSync(
    path.join(root, "platformio.ini"),
    "[env:fixture]\nplatform=espressif32\n",
  );
  fs.writeFileSync(
    path.join(root, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { audit_all_agent_actions: false },
    }),
  );
  fs.writeFileSync(path.join(root, "table.csv"), "app,app,factory,,1M,");
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});
it("uses launch project defaults and reports actual offline CSV provenance", async () => {
  const result = await executePartitionCompatibility(
    {
      project_dir: null,
      env: null,
      port: null,
      build_metadata: false,
      table_path: "table.csv",
      table_offset: 0x8000,
    },
    { projectDir: root },
  );
  expect(result).toMatchObject({
    ok: true,
    effective_table_format: "csv",
    csv_source: "explicit:tablePath",
    device: {},
    firmware_bin: null,
  });
  expect(result.csv_path).toBe(
    fs.realpathSync.native(path.join(root, "table.csv")),
  );
});
it("rejects unsupported device-control arguments before reading the project", async () => {
  await expect(
    executePartitionCompatibility(
      { read_device: false, stop_open_sessions: true },
      { projectDir: root },
    ),
  ).rejects.toThrow();
});
