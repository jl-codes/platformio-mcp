/** Shared-entrypoint authorization must precede execution and preserve workflow identity. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeAction,
  dispatchAuthorizedAction,
} from "../src/core/action-dispatcher.js";
import {
  MCP_ACTIONS,
  policyActionForCliCommand,
} from "../src/core/action-catalog.js";
import { approveRequest } from "../src/core/policy/approvals.js";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-dispatch-"));
  vi.stubEnv("PIO_MCP_DATA_DIR", root);
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("shared action authorization", () => {
  it.each(["does_not_exist", "constructor", "__proto__"])(
    "rejects unknown operation %s without effects",
    async (name) => {
      const execute = vi.fn();
      await expect(
        dispatchAuthorizedAction(name, {}, {}, execute),
      ).rejects.toMatchObject({ code: "UNKNOWN_ACTION" });
      expect(execute).not.toHaveBeenCalled();
    },
  );
  it("blocks callbacks under an explicit project deny", async () => {
    fs.writeFileSync(
      path.join(root, ".pio-mcp-policy.json"),
      '{"profile":"read_only"}',
    );
    const execute = vi.fn();
    await expect(
      dispatchAuthorizedAction(
        "build_project",
        { projectDir: root },
        { workspaceDir: root },
        execute,
      ),
    ).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not reuse a simple-upload grant for a composite workflow", async () => {
    const args = { projectDir: root, port: "COM7" };
    const context = { workspaceDir: root, actor: "agent" as const };
    const pending = await authorizeAction("upload_firmware", args, context);
    approveRequest(pending.approvalId!);
    const execute = vi.fn(async () => ({ result: "unchanged" }));
    await expect(
      dispatchAuthorizedAction(
        "agent_flash_monitor_verify",
        { ...args, approvalId: pending.approvalId },
        context,
        execute,
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(execute).not.toHaveBeenCalled();
    await expect(
      dispatchAuthorizedAction(
        "upload_firmware",
        { ...args, approvalId: pending.approvalId },
        context,
        execute,
      ),
    ).resolves.toEqual({ result: "unchanged" });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("uses the same permission identity for equivalent CLI and MCP entrypoints", () => {
    expect(Object.keys(MCP_ACTIONS)).toHaveLength(42);
    for (const [cli, operation] of [
      ["task-status", "check_task_status"],
      ["dashboard", "get_dashboard_url"],
      ["agent-build-diagnose", "agent_build_diagnose"],
      ["agent-flash-monitor-verify", "agent_flash_monitor_verify"],
    ]) {
      expect(policyActionForCliCommand(cli)).toBe(
        MCP_ACTIONS[operation].policyAction ?? operation,
      );
    }
  });
});
