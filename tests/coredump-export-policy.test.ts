/** Public acquisition exports preserve empty raw partitions without returning memory bytes. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("../src/tools/coredump-device.js", () => ({
  acquireProjectCoredump: vi.fn(),
}));
import { acquireProjectCoredump } from "../src/tools/coredump-device.js";
import { executeCoredump } from "../src/tools/coredump.js";
let root: string, state: string;
beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-core-export-policy-"));
  state = fs.mkdtempSync(path.join(os.tmpdir(), "pio-core-export-state-"));
  vi.stubEnv("PIO_MCP_DATA_DIR", state);
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});
function request() {
  return {
    projectDir: root,
    analyze: false,
    outPath: "crash.bin",
    device: {
      port: "port",
      table: {
        projectDir: root,
        tablePath: "partitions.csv",
        tableOffset: 0x8000,
      },
    },
  };
}
it("preflights export denial before device acquisition", async () => {
  fs.writeFileSync(
    path.join(root, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { audit_all_agent_actions: false },
    }),
  );
  await expect(executeCoredump(request())).rejects.toMatchObject({
    code: "POLICY_DENIED",
  });
  expect(acquireProjectCoredump).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(root, "crash.bin"))).toBe(false);
});
it("exports an erased partition but returns no raw bytes and no false success", async () => {
  const policy = path.join(state, "operator.json");
  vi.stubEnv("PIO_MCP_POLICY_FILE", policy);
  fs.writeFileSync(
    policy,
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        allow: ["run_shell_command", "get_project_config"],
        deny: [],
        approval_required: [],
        audit_all_agent_actions: false,
      },
    }),
  );
  const bytes = Buffer.alloc(4096, 255);
  vi.mocked(acquireProjectCoredump).mockResolvedValueOnce({
    present: false,
    bytes,
    source: {
      port: "port",
      offset: 0x310000,
      length: 4096,
      sha256: "fixture",
      logPath: "log",
      partition: "crash",
    },
    layout: {
      table: { path: "table", size: 1, sha256: "fixture" },
      table_offset: 0x8000,
      environment: null,
      table_source: "explicit",
      evidence: "offline_layout",
    },
  });
  const result = await executeCoredump(request());
  expect(result).toMatchObject({
    ok: false,
    error: "no_coredump",
    dump_export: { size: 4096, retention: "user_managed" },
  });
  expect(result).not.toHaveProperty("bytes");
  expect(fs.readFileSync(path.join(root, "crash.bin"))).toEqual(bytes);
}, 20000);

