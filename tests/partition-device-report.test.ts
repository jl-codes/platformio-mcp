/** Device observations must produce actionable structured findings without claiming hardware acceptance. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { executePartitionTable } from "../src/tools/partition-table.js";
import { readEspFlash } from "../src/core/esp-flash-read.js";
vi.mock("../src/core/esp-flash-read.js", () => ({ readEspFlash: vi.fn() }));
let root: string;
let state: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-partition-device-"));
  state = fs.mkdtempSync(path.join(os.tmpdir(), "pio-partition-device-state-"));
  vi.stubEnv("PIO_MCP_DATA_DIR", state);
  fs.writeFileSync(
    path.join(root, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { audit_all_agent_actions: false },
    }),
  );
  fs.writeFileSync(path.join(root, "table.csv"), "app,app,factory,0x10000,1M,");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});
function binary(size: number): Buffer {
  const bytes = Buffer.alloc(4096, 255);
  bytes.writeUInt16LE(0x50aa, 0);
  bytes[2] = 0;
  bytes[3] = 0;
  bytes.writeUInt32LE(0x10000, 4);
  bytes.writeUInt32LE(size, 8);
  bytes.fill(0, 12, 32);
  bytes.write("app", 12);
  return bytes;
}
it.each([
  {
    kind: "erased",
    bytes: () => Buffer.alloc(4096, 255),
    code: "device_table_erased",
  },
  {
    kind: "changed",
    bytes: () => binary(0x200000),
    code: "device_table_mismatch",
  },
])(
  "reports $kind device contents as a structured error",
  async ({ bytes, code }) => {
    vi.mocked(readEspFlash).mockResolvedValue({
      bytes: bytes(),
      sha256: "fixture",
      port: "COM9",
      offset: 0x8000,
      length: 4096,
      logPath: "read.log",
    });
    const result = await executePartitionTable({
      projectDir: root,
      tablePath: "table.csv",
      tableOffset: 0x8000,
      readDevice: true,
      port: "COM9",
    });
    expect(result.ok).toBe(false);
    expect(result.error_count).toBe(1);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: "error", code }),
    );
    expect(result).not.toHaveProperty("partitionRecords");
  },
);
it("keeps successful observed comparison distinct from an absent observation", async () => {
  vi.mocked(readEspFlash).mockResolvedValue({
    bytes: binary(0x100000),
    sha256: "fixture",
    port: "COM9",
    offset: 0x8000,
    length: 4096,
    logPath: "read.log",
  });
  const result = await executePartitionTable({
    projectDir: root,
    tablePath: "table.csv",
    tableOffset: 0x8000,
    readDevice: true,
    port: "COM9",
  });
  expect(result).toMatchObject({
    ok: true,
    error_count: 0,
    device: { erased: false, diff: [], port: "COM9" },
  });
});
