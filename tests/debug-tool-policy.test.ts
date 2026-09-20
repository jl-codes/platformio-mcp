/** Canonical debugger denies and approvals apply to aliases before connection services execute. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { executeDebugTool } from "../src/adapters/debug-tool-dispatch.js";
import type { DebugCompatibilityClient } from "../src/adapters/debug-compat.js";
let root: string, project: string;
beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pio-debug-public-")),
  );
  project = path.join(root, "project");
  await fs.mkdir(project);
  await fs.writeFile(
    path.join(project, "platformio.ini"),
    "[env:fixture]\nplatform=native\n",
  );
  vi.stubEnv("PIO_MCP_DATA_DIR", path.join(root, "state"));
  vi.stubEnv("PIO_MCP_POLICY_FILE", path.join(root, "policy.json"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
const id = "00000000-0000-4000-8000-000000000000";
const operations = [
  ["debug_start", {}],
  ["debug_cmd", { session_id: id, command: "continue" }],
  ["debug_stop", { session_id: id }],
  ["debug_list", {}],
] as const;
it.each(operations)(
  "%s rules constrain both names before side effects",
  async (canonical, args) => {
    const start = vi.fn(),
      execute = vi.fn();
    const client = {
      start,
      execute,
      projectForSession: () => project,
    } as unknown as DebugCompatibilityClient;
    for (const effect of ["deny", "approval_required"]) {
      await fs.writeFile(
        path.join(root, "policy.json"),
        JSON.stringify({
          profile: "lab_admin",
          overrides: {
            allow: ["run_shell_command", "query_logs"],
            deny: [],
            approval_required: [],
            [effect]: [canonical],
            audit_all_agent_actions: false,
          },
        }),
      );
      for (const name of [canonical, `pio_${canonical}`] as const)
        await expect(
          executeDebugTool(
            client,
            name,
            args,
            { projectDir: project },
            { workspaceDir: project },
          ),
        ).rejects.toMatchObject({
          code: effect === "deny" ? "POLICY_DENIED" : "APPROVAL_REQUIRED",
        });
    }
    expect(start).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  },
);
it("keeps process-only cleanup available without public target grants", async () => {
  await fs.writeFile(
    path.join(root, "policy.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { deny: ["debug_stop"], audit_all_agent_actions: false },
    }),
  );
  const execute = vi.fn().mockResolvedValue({ ok: true });
  const client = {
    execute,
    projectForSession: vi.fn(),
  } as unknown as DebugCompatibilityClient;
  await executeDebugTool(
    client,
    "pio_debug_stop",
    { session_id: id, process_only: true },
    {},
    {},
  );
  expect(execute).toHaveBeenCalledWith(
    "pio_debug_stop",
    expect.objectContaining({ session_id: id, process_only: true }),
    {},
  );
});
it("rejects forged project scope on session operations", async () => {
  const execute = vi.fn();
  const client = {
    execute,
    projectForSession: vi.fn(),
  } as unknown as DebugCompatibilityClient;
  await expect(
    executeDebugTool(
      client,
      "debug_cmd",
      { session_id: id, command: "bt", project_dir: project },
      {},
      {},
    ),
  ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});
