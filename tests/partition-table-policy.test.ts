/** Permission denial must precede any partition artifact access. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { executePartitionTable } from "../src/tools/partition-table.js";
let root: string;
let state: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-partition-policy-"));
  state = fs.mkdtempSync(path.join(os.tmpdir(), "pio-partition-state-"));
  vi.stubEnv("PIO_MCP_DATA_DIR", state);
  fs.writeFileSync(
    path.join(root, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { audit_all_agent_actions: false },
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});
it("uses canonical read permission for explicit offline artifacts", async () => {
  fs.writeFileSync(path.join(root, "table.csv"), "app,app,factory,0x10000,1M,");
  const result = await executePartitionTable({
    projectDir: root,
    tablePath: "table.csv",
    format: "csv",
    tableOffset: 0x8000,
  });
  expect(result.ok).toBe(true);
  expect(result.summary).toContain("offline artifacts");
});
it("honors concrete denial before trying to open an absent artifact", async () => {
  fs.writeFileSync(
    path.join(root, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { deny: ["partition_table"], audit_all_agent_actions: false },
    }),
  );
  await expect(
    executePartitionTable({
      projectDir: root,
      tablePath: "absent.csv",
      format: "csv",
      tableOffset: 0x8000,
    }),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
});
it("rejects device-read arguments instead of silently ignoring them", async () => {
  await expect(
    executePartitionTable({
      projectDir: root,
      tablePath: "absent.csv",
      format: "csv",
      tableOffset: 0x8000,
      read_device: true,
    }),
  ).rejects.toThrow();
});

it("resolves custom offsets from authorized SDK configuration bytes", async () => {
  fs.writeFileSync(path.join(root, "table.csv"), "app,app,factory,,1M,");
  fs.writeFileSync(
    path.join(root, "sdkconfig.custom"),
    "CONFIG_PARTITION_TABLE_OFFSET=0x10000\n",
  );
  const result = await executePartitionTable({
    projectDir: root,
    tablePath: "table.csv",
    format: "csv",
    sdkconfigPath: "sdkconfig.custom",
  });
  expect(result.table_offset).toBe(0x10000);
  expect(result.partitions[0].offset).toBe(0x20000);
  expect(result.sdkconfig_artifact?.sha256).toMatch(/^[a-f0-9]{64}$/);
});
it("rejects conflicting explicit and configured offsets before reading the table", async () => {
  fs.writeFileSync(
    path.join(root, "sdkconfig"),
    "CONFIG_PARTITION_TABLE_OFFSET=0x10000\n",
  );
  await expect(
    executePartitionTable({
      projectDir: root,
      tablePath: "absent.csv",
      format: "csv",
      tableOffset: 0x8000,
      sdkconfigPath: "sdkconfig",
    }),
  ).rejects.toMatchObject({ code: "PARTITION_OFFSET_CONFLICT" });
});
it("keeps missing SDK configuration evidence unknown", async () => {
  fs.writeFileSync(path.join(root, "sdkconfig"), "CONFIG_OTHER=y\n");
  await expect(
    executePartitionTable({
      projectDir: root,
      tablePath: "absent.csv",
      format: "csv",
      sdkconfigPath: "sdkconfig",
    }),
  ).rejects.toMatchObject({ code: "PARTITION_OFFSET_REQUIRED" });
});
