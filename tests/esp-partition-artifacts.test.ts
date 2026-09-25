/** Offline artifact reports stay inside their granted workspace and retain byte identities. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { beforeEach, afterEach, expect, it } from "vitest";
import { inspectEspPartitionArtifacts } from "../src/core/esp-partition-artifacts.js";
let root: string;
const csv = "app,app,factory,0x10000,1M,\n";
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pio-partitions-"));
  await fs.writeFile(path.join(root, "partitions.csv"), csv);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it("binds the report to table and firmware bytes", async () => {
  await fs.writeFile(path.join(root, "firmware.bin"), Buffer.alloc(32, 7));
  const result = await inspectEspPartitionArtifacts({
    workspaceDir: root,
    tablePath: "partitions.csv",
    format: "csv",
    layout: { tableOffset: 0x8000 },
    firmwarePath: "firmware.bin",
  });
  expect(result).toMatchObject({
    ok: true,
    firmware_size: 32,
    comparison: null,
    comparison_source: null,
  });
  expect(result.artifacts.table.sha256).toBe(
    createHash("sha256").update(csv).digest("hex"),
  );
  expect(result.artifacts.firmware?.sha256).toBe(
    createHash("sha256").update(Buffer.alloc(32, 7)).digest("hex"),
  );
});
it("rejects an existing file outside the permitted project", async () => {
  const child = path.join(root, "project");
  await fs.mkdir(child);
  await expect(
    inspectEspPartitionArtifacts({
      workspaceDir: child,
      tablePath: "../partitions.csv",
      format: "csv",
      layout: { tableOffset: 0x8000 },
    }),
  ).rejects.toMatchObject({ code: "PARTITION_ARTIFACT_OUTSIDE_WORKSPACE" });
});
it("rejects oversized tables before parsing", async () => {
  await fs.writeFile(path.join(root, "oversize.csv"), Buffer.alloc(65537));
  await expect(
    inspectEspPartitionArtifacts({
      workspaceDir: root,
      tablePath: "oversize.csv",
      format: "csv",
      layout: { tableOffset: 0x8000 },
    }),
  ).rejects.toMatchObject({ code: "PARTITION_ARTIFACT_INVALID" });
});
it("rejects malformed UTF-8 rather than replacing partition names", async () => {
  await fs.writeFile(path.join(root, "invalid.csv"), Buffer.from([0xff, 0xff]));
  await expect(
    inspectEspPartitionArtifacts({
      workspaceDir: root,
      tablePath: "invalid.csv",
      format: "csv",
      layout: { tableOffset: 0x8000 },
    }),
  ).rejects.toMatchObject({ code: "PARTITION_TABLE_INVALID" });
});
