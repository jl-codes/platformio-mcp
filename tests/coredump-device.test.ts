/** Effective-table acquisition tests use real offline parsing and policy with a substituted device read. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("../src/core/analysis/esp-coredump-read.js", () => ({
  readEspCoredumpPartition: vi.fn(),
}));
import { readEspCoredumpPartition } from "../src/core/analysis/esp-coredump-read.js";
import { acquireProjectCoredump } from "../src/tools/coredump-device.js";
let root: string, state: string;
beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-core-table-"));
  state = fs.mkdtempSync(path.join(os.tmpdir(), "pio-core-table-state-"));
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
const table = () => ({
  projectDir: root,
  tablePath: "partitions.csv",
  tableOffset: 0x8000,
});
it("uses the effective CSV offset and preserves its source hash", async () => {
  fs.writeFileSync(
    path.join(root, "partitions.csv"),
    "app,app,factory,0x10000,1M,\ncrash,data,coredump,0x310000,64K,\n",
  );
  vi.mocked(readEspCoredumpPartition).mockResolvedValueOnce({
    present: false,
    bytes: Buffer.alloc(65536, 255),
    source: {
      port: "port",
      offset: 0x310000,
      length: 65536,
      sha256: "fixture",
      logPath: "log",
      partition: "crash",
    },
  });
  const result = await acquireProjectCoredump(table(), { port: "port" });
  expect(result.layout.table.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(readEspCoredumpPartition).toHaveBeenCalledWith(
    expect.objectContaining({
      partition: expect.objectContaining({ offset: 0x310000, size: 65536 }),
    }),
    {},
  );
});
it("rejects an ambiguous table before a device read", async () => {
  fs.writeFileSync(
    path.join(root, "partitions.csv"),
    "app,app,factory,0x10000,1M,\nfirst,data,coredump,0x310000,64K,\nsecond,data,coredump,0x320000,64K,\n",
  );
  await expect(
    acquireProjectCoredump(table(), { port: "port" }),
  ).rejects.toMatchObject({ code: "COREDUMP_PARTITION_AMBIGUOUS" });
  expect(readEspCoredumpPartition).not.toHaveBeenCalled();
});
it("rejects absent crash storage before a device read", async () => {
  fs.writeFileSync(
    path.join(root, "partitions.csv"),
    "app,app,factory,0x10000,1M,\n",
  );
  await expect(
    acquireProjectCoredump(table(), { port: "port" }),
  ).rejects.toMatchObject({ code: "COREDUMP_PARTITION_MISSING" });
  expect(readEspCoredumpPartition).not.toHaveBeenCalled();
});
