/** Permission denial must precede any partition artifact access. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { executePartitionTable } from "../src/tools/partition-table.js";
import { executeProjectInspection } from "../src/tools/project-inspection.js";
vi.mock("../src/tools/project-inspection.js", () => ({
  executeProjectInspection: vi.fn(),
}));
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

it("inspects the selected project's configured table and offset", async () => {
  fs.writeFileSync(path.join(root, "custom.csv"), "app,app,factory,,1M,");
  vi.mocked(executeProjectInspection).mockResolvedValue({
    ok: true,
    exitCode: 0,
    projectDir: root,
    summary: "fixture",
    defaultEnvironments: ["custom"],
    platformioSection: {},
    envs: [
      {
        name: "custom",
        partitionTable: "custom.csv",
        partitionTableUploadOffset: "0x10000",
        flashSize: "8MB",
        board: "fixture",
        mcu: "esp32s3",
      },
    ],
  } as unknown as Awaited<ReturnType<typeof executeProjectInspection>>);
  const result = await executePartitionTable({ projectDir: root });
  expect(result).toMatchObject({
    ok: true,
    environment: "custom",
    table_source: "board_build.partitions",
    table_offset: 0x10000,
    flash_size: 8388608,
  });
  expect(result.partitions[0].offset).toBe(0x20000);
});
it("does not silently choose among multiple default environments", async () => {
  vi.mocked(executeProjectInspection).mockResolvedValue({
    ok: true,
    defaultEnvironments: ["first", "second"],
    envs: [{ name: "first" }, { name: "second" }],
  } as unknown as Awaited<ReturnType<typeof executeProjectInspection>>);
  await expect(
    executePartitionTable({ projectDir: root }),
  ).rejects.toMatchObject({ code: "PARTITION_ENVIRONMENT_REQUIRED" });
});

it("reports the actual metadata-selected binary source", async () => {
  const table = path.join(root, "partitions.bin");
  const bytes = Buffer.alloc(96, 255);
  bytes.writeUInt16LE(0x50aa, 0);
  bytes[2] = 0;
  bytes[3] = 0;
  bytes.writeUInt32LE(0x20000, 4);
  bytes.writeUInt32LE(0x100000, 8);
  bytes.fill(0, 12, 32);
  bytes.write("app", 12, "utf8");
  fs.writeFileSync(table, bytes);
  vi.mocked(executeProjectInspection)
    .mockResolvedValueOnce({
      ok: true,
      defaultEnvironments: ["custom"],
      envs: [
        {
          name: "custom",
          partitionTable: null,
          partitionTableUploadOffset: null,
          flashSize: null,
          board: null,
          mcu: null,
        },
      ],
    } as unknown as Awaited<ReturnType<typeof executeProjectInspection>>)
    .mockResolvedValueOnce({
      ok: true,
      envs: {
        custom: {
          extra: { flash_images: [{ path: table, offset: "0x10000" }] },
        },
      },
    } as unknown as Awaited<ReturnType<typeof executeProjectInspection>>);
  const result = await executePartitionTable({
    projectDir: root,
    buildMetadata: true,
  });
  expect(result).toMatchObject({
    ok: true,
    table_source: "metadata:extra.flash_images",
    table_offset: 0x10000,
  });
  expect(result.artifacts.table.path).toBe(fs.realpathSync.native(table));
});

it("requires device permission even when offline layout inspection is permitted", async () => {
  fs.writeFileSync(path.join(root, "table.csv"), "app,app,factory,,1M,");
  await expect(
    executePartitionTable({
      projectDir: root,
      tablePath: "table.csv",
      tableOffset: 0x8000,
      readDevice: true,
      port: "COM9",
    }),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
});

it("compares an explicit CSV with its metadata-selected built binary", async () => {
  fs.writeFileSync(path.join(root, "table.csv"), "app,app,factory,0x20000,1M,");
  const table = path.join(root, "partitions.bin");
  const bytes = Buffer.alloc(96, 255);
  bytes.writeUInt16LE(0x50aa, 0);
  bytes[2] = 0;
  bytes[3] = 0;
  bytes.writeUInt32LE(0x20000, 4);
  bytes.writeUInt32LE(0x200000, 8);
  bytes.fill(0, 12, 32);
  bytes.write("app", 12, "utf8");
  fs.writeFileSync(table, bytes);
  vi.mocked(executeProjectInspection)
    .mockResolvedValueOnce({
      ok: true,
      defaultEnvironments: ["custom"],
      envs: [
        {
          name: "custom",
          partitionTable: null,
          partitionTableUploadOffset: null,
          flashSize: null,
          board: null,
          mcu: null,
        },
      ],
    } as unknown as Awaited<ReturnType<typeof executeProjectInspection>>)
    .mockResolvedValueOnce({
      ok: true,
      envs: {
        custom: {
          extra: { flash_images: [{ path: table, offset: "0x10000" }] },
        },
      },
    } as unknown as Awaited<ReturnType<typeof executeProjectInspection>>);
  const result = await executePartitionTable({
    projectDir: root,
    tablePath: "table.csv",
    buildMetadata: true,
  });
  expect(result).toMatchObject({
    ok: false,
    comparison_source: "build_binary",
    error_count: 1,
  });
  expect(result.comparison).toMatchObject([
    { name: "app", kind: "changed", fields: ["size"] },
  ]);
  expect(result.issues).toContainEqual(
    expect.objectContaining({ code: "offline_table_mismatch" }),
  );
});
