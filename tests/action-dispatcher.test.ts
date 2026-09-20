/** Shared-entrypoint authorization must precede execution and preserve workflow identity. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeAction,
  planAction,
  dispatchAuthorizedAction,
} from "../src/core/action-dispatcher.js";
import {
  MCP_ACTIONS,
  policyActionForCliCommand,
} from "../src/core/action-catalog.js";
import { approveRequest, getApproval } from "../src/core/policy/approvals.js";
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
    expect(Object.keys(MCP_ACTIONS)).toHaveLength(54);
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

function operatorPolicy(document: unknown) {
  fs.writeFileSync(path.join(root, "policy.yaml"), JSON.stringify(document));
}
it("honors concrete-operation denies even when its shared category is allowed", async () => {
  operatorPolicy({ deny: ["pkg_install", "size_report"] });
  expect((await authorizeAction("pkg_install", {}, {})).status).toBe("deny");
  expect((await authorizeAction("size_report", {}, {})).status).toBe("deny");
  expect((await authorizeAction("install_library", {}, {})).status).toBe(
    "allow",
  );
  expect((await authorizeAction("build_project", {}, {})).status).toBe("allow");
});
it("a category deny wins over a narrower tool grant", async () => {
  operatorPolicy({ allow: ["pkg_install"], deny: ["install_library"] });
  expect((await authorizeAction("pkg_install", {}, {})).status).toBe("deny");
});
it("an exact operation allow list does not enable its category or siblings", async () => {
  operatorPolicy({ allow: ["size_report"] });
  expect((await authorizeAction("size_report", {}, {})).status).toBe("allow");
  expect((await authorizeAction("decode_backtrace", {}, {})).status).toBe(
    "deny",
  );
  expect((await authorizeAction("build_project", {}, {})).status).toBe("deny");
});
it("retains restrictive project approval requirements for mapped operations without enrollment", async () => {
  const project = path.join(root, "project");
  fs.mkdirSync(project);
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "flash_requires_approval",
      overrides: { approval_required: ["size_report"] },
    }),
  );
  const context = { workspaceDir: project };
  const args = { projectDir: project };
  const pending = await authorizeAction("size_report", args, context);
  expect(pending.status).toBe("requires_approval");
  approveRequest(pending.approvalId!);
  expect(
    (
      await authorizeAction(
        "size_report",
        { ...args, approvalId: pending.approvalId },
        context,
      )
    ).status,
  ).toBe("allow");
  expect(
    (
      await authorizeAction(
        "size_report",
        { ...args, approvalId: pending.approvalId },
        context,
      )
    ).status,
  ).toBe("requires_approval");
});
it("keeps category approval requirements when only a narrow operation is allowed", async () => {
  operatorPolicy({
    allow: ["size_report"],
    approval_required: ["build_project"],
  });
  expect((await authorizeAction("size_report", {}, {})).status).toBe(
    "requires_approval",
  );
});

it("plans approval readiness without consuming a grant or bypassing later policy", async () => {
  const args = { projectDir: root, port: "COM7" };
  const context = { workspaceDir: root };
  const pending = await planAction("upload_firmware", args, context);
  expect(pending.status).toBe("requires_approval");
  approveRequest(pending.approvalId!);
  const approved = { ...args, approvalId: pending.approvalId };
  expect((await planAction("upload_firmware", approved, context)).status).toBe(
    "ready",
  );
  expect((await planAction("upload_firmware", approved, context)).status).toBe(
    "ready",
  );
  expect(getApproval(pending.approvalId!)?.status).toBe("approved");
  expect(
    (
      await planAction(
        "upload_firmware",
        { ...approved, port: "COM8" },
        context,
      )
    ).status,
  ).toBe("requires_approval");
  const execute = vi.fn(async () => "done");
  expect(
    await dispatchAuthorizedAction(
      "upload_firmware",
      approved,
      context,
      execute,
    ),
  ).toBe("done");
  expect(getApproval(pending.approvalId!)?.status).toBe("consumed");
  expect((await planAction("upload_firmware", approved, context)).status).toBe(
    "requires_approval",
  );
  expect(execute).toHaveBeenCalledOnce();
});
it("planning does not override a deny and caller arguments cannot enable planning for execution", async () => {
  const args = { projectDir: root, port: "COM7", planning: true };
  const context = { workspaceDir: root };
  const pending = await planAction("upload_firmware", args, context);
  approveRequest(pending.approvalId!);
  await dispatchAuthorizedAction(
    "upload_firmware",
    { ...args, approvalId: pending.approvalId },
    context,
    async () => {},
  );
  expect(getApproval(pending.approvalId!)?.status).toBe("consumed");
  fs.writeFileSync(
    path.join(root, ".pio-mcp-policy.json"),
    '{"profile":"read_only"}',
  );
  expect((await planAction("upload_firmware", args, context)).status).toBe(
    "deny",
  );
});
