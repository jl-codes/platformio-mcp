/** Configured reset/run hooks need two privileges and retain the session when acknowledgment fails. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  DebugClientSessions,
  type OwnedDebugProcess,
} from "../src/core/debug/debug-client-sessions.js";
import { dispatchDebuggerCommand } from "../src/core/debug/debug-command.js";
import { approveRequest, getApproval } from "../src/core/policy/approvals.js";
let root: string;
beforeEach(() => {
  root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "pio-reset-run-")),
  );
  vi.stubEnv("PIO_MCP_POLICY_FILE", path.join(root, "policy.json"));
  vi.stubEnv("PIO_MCP_DATA_DIR", path.join(root, "data"));
  policy();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
function policy(deny: string[] = [], approval: string[] = []) {
  fs.writeFileSync(
    path.join(root, "policy.json"),
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        allow: ["upload_firmware", "run_shell_command"].filter(
          (value) => !deny.includes(value),
        ),
        deny,
        approval_required: approval,
        audit_all_agent_actions: false,
      },
    }),
  );
}
async function fixture() {
  const writes: string[] = [];
  const send = vi.fn(async () => ({
    token: "1",
    result: { kind: "result" as const, class: "done", fields: [] },
    console: [],
    truncated: false,
    timedOut: false,
    running: false,
    closed: false,
    exitCode: null,
  }));
  const owner: OwnedDebugProcess = {
    command: (command, caller, _timeout, grants) =>
      dispatchDebuggerCommand(
        command,
        { ...grants, projectDir: root },
        caller,
        async (prepared) => {
          writes.push(prepared.miCommand);
          return send();
        },
      ),
    state: vi.fn(),
    cleanupProcess: vi.fn(async () => {}),
  };
  const sessions = new DebugClientSessions();
  const id = await sessions.start(root, "debug", async () => owner);
  return { sessions, id, owner, writes, send };
}
it("acknowledges reset/run before cleanup and removing the session", async () => {
  const f = await fixture();
  await f.sessions.resetRunAndStop(f.id, {});
  expect(f.writes).toEqual([
    '-interpreter-exec console "pio_reset_run_target"',
  ]);
  expect(f.owner.cleanupProcess).toHaveBeenCalledOnce();
  expect(f.sessions.list()).toEqual([]);
});
it.each(["run_shell_command", "upload_firmware"])(
  "denies %s before writing or cleanup",
  async (denied) => {
    policy([denied]);
    const f = await fixture();
    await expect(f.sessions.resetRunAndStop(f.id, {})).rejects.toMatchObject({
      code: "POLICY_DENIED",
    });
    expect(f.writes).toEqual([]);
    expect(f.owner.cleanupProcess).not.toHaveBeenCalled();
    await f.sessions.stop(f.id);
  },
);
it("retains failed reset/run for independent process cleanup", async () => {
  const f = await fixture();
  f.send.mockResolvedValueOnce({ ...(await f.send()), timedOut: true });
  await expect(f.sessions.resetRunAndStop(f.id, {})).rejects.toMatchObject({
    code: "DEBUG_RESET_RUN_FAILED",
  });
  expect(f.owner.cleanupProcess).not.toHaveBeenCalled();
  expect(f.sessions.list()).toHaveLength(1);
  await f.sessions.stop(f.id);
});
it("plans both real grants before consuming either", async () => {
  policy([], ["run_shell_command", "upload_firmware"]);
  const f = await fixture();
  const grants: { hostApprovalId?: string; targetApprovalId?: string } = {};
  for (const field of ["hostApprovalId", "targetApprovalId"] as const) {
    const error = await f.sessions
      .resetRunAndStop(f.id, {}, 1000, grants)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "APPROVAL_REQUIRED" });
    const id = (
      error as { context: { policyDecision: { approvalId: string } } }
    ).context.policyDecision.approvalId;
    approveRequest(id);
    grants[field] = id;
    expect(f.writes).toEqual([]);
  }
  await f.sessions.resetRunAndStop(f.id, {}, 1000, grants);
  for (const id of Object.values(grants))
    expect(getApproval(id)?.status).toBe("consumed");
});

it("does not bypass target policy when the hook is sent as an ordinary command", async () => {
  policy(["upload_firmware"]);
  const send = vi.fn();
  await expect(
    dispatchDebuggerCommand(
      "pio_reset_run_target",
      { projectDir: root, sessionId: "owned" },
      { workspaceDir: root },
      send,
    ),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(send).not.toHaveBeenCalled();
});
