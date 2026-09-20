/** Real policy checks ensure artifact inspection cannot escalate into analyzer execution. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { executeCoredump } from "../src/tools/coredump.js";
let root: string;
let state: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-core-policy-"));
  state = fs.mkdtempSync(path.join(os.tmpdir(), "pio-core-state-"));
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
it("returns identities without exposing raw bytes under read permission", async () => {
  fs.writeFileSync(
    path.join(root, "dump.raw"),
    Buffer.from(
      "2400000003000000010000000400000000000000020000006669787475726521168fe1cf",
      "hex",
    ),
  );
  const result = await executeCoredump({
    projectDir: root,
    dumpPath: "dump.raw",
    analyze: false,
  });
  expect(result).toMatchObject({ ok: true, analyzed: false });
  expect(result).not.toHaveProperty("bytes");
});
it("requires execution permission before looking up absent analysis artifacts", async () => {
  await expect(
    executeCoredump({
      projectDir: root,
      dumpPath: "absent.raw",
      elfPath: "absent.elf",
    }),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
});
it.each(["coredump", "coredump_inspect", "get_project_config"])(
  "honors %s denial before file access",
  async (deniedAction) => {
    fs.writeFileSync(
      path.join(root, ".pio-mcp-policy.json"),
      JSON.stringify({
        profile: "read_only",
        overrides: { deny: [deniedAction], audit_all_agent_actions: false },
      }),
    );
    await expect(
      executeCoredump({
        projectDir: root,
        dumpPath: "absent.raw",
        analyze: false,
      }),
    ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  },
);
it("requires device-read permission even when analysis is disabled", async () => {
  fs.writeFileSync(
    path.join(root, "partitions.csv"),
    "app,app,factory,0x10000,1M,\ncrash,data,coredump,0x310000,64K,\n",
  );
  await expect(
    executeCoredump({
      projectDir: root,
      analyze: false,
      device: {
        port: "never-open-this-port",
        table: {
          projectDir: root,
          tablePath: "partitions.csv",
          tableOffset: 0x8000,
        },
      },
    }),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
});
it("rejects requests mixing a dump file with live acquisition", async () => {
  await expect(
    executeCoredump({
      projectDir: root,
      dumpPath: "absent.raw",
      analyze: false,
      device: { port: "port", table: { projectDir: root } },
    }),
  ).rejects.toThrow("Select exactly one");
});
