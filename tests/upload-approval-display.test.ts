/** Upload port aliases remain visible to operators without changing raw, single-use grant scope. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { evaluatePolicy } from "../src/core/policy/evaluate-policy.js";
import {
  approveRequest,
  getApproval,
  getApprovalRequestSummary,
  listPendingApprovalSummaries,
} from "../src/core/policy/approvals.js";
import { approvalScopeDigest } from "../src/core/policy/approval-scope.js";
import { readRecentAuditEvents } from "../src/core/policy/audit-log.js";
import { loadEffectivePolicyState } from "../src/core/policy/load-policy.js";
import type { PolicyEvaluationContext } from "../src/core/policy/types.js";
import { UploadFirmwareParamsSchema } from "../src/types.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-upload-display-"));
  vi.stubEnv("PIO_MCP_DATA_DIR", root);
  vi.stubEnv("PIO_MCP_POLICY_FILE", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

/** Match the MCP authorization context, including its original missing alias-derived devicePort. */
function caller(): PolicyEvaluationContext {
  return {
    workspaceDir: root,
    actor: "agent",
    actorClass: "interactive",
    operationName: "upload_firmware",
    devicePort: undefined,
  };
}

it.each(["port", "uploadPort", "upload_port"])(
  "shows %s in approval summaries and audit events, keeping the original digest",
  async (key) => {
    const args = Object.freeze({
      projectDir: root,
      environment: "native",
      [key]: "/dev/tty.usbmodem101",
      auth: "do-not-persist-secret",
    });
    const context = Object.freeze(caller());
    const snapshot = { ...args };
    const originalDigest = approvalScopeDigest(
      "upload_firmware",
      args,
      loadEffectivePolicyState(root).digest,
      context,
    );
    const decision = await evaluatePolicy("upload_firmware", args, context);
    expect(decision.status).toBe("requires_approval");
    const id = decision.approvalId!;
    expect(getApproval(id)?.scopeDigest).toBe(originalDigest);
    expect(getApprovalRequestSummary(id, root)?.port).toBe(args[key]);
    expect(listPendingApprovalSummaries({ projectDir: root })).toEqual([
      expect.objectContaining({ id, port: args[key] }),
    ]);
    expect(readRecentAuditEvents({ workspaceDir: root })).toEqual([
      expect.objectContaining({
        approvalId: id,
        status: "requires_approval",
        devicePort: args[key],
      }),
    ]);
    const persisted = fs.readFileSync(
      path.join(root, "approvals.json"),
      "utf8",
    );
    expect(persisted).not.toContain("do-not-persist-secret");
    expect(getApproval(id)?.metadata?.args).toEqual({
      projectDir: root,
      environment: "native",
      port: args[key],
    });
    expect(args).toEqual(snapshot);
    expect(context).toEqual(caller());

    approveRequest(id);
    // Equivalent selector spellings still change the raw request and cannot replay its grant.
    for (const changed of [
      { ...args, [key]: "/dev/cu.usbmodem101", approvalId: id },
      {
        projectDir: root,
        environment: "native",
        port: args[key],
        auth: args.auth,
        upload_port: args[key],
        approvalId: id,
      },
    ]) {
      expect(
        (await evaluatePolicy("upload_firmware", changed, context)).status,
      ).toBe("requires_approval");
      expect(getApproval(id)?.status).toBe("approved");
    }
    expect(
      (
        await evaluatePolicy(
          "upload_firmware",
          { ...args, approvalId: id },
          context,
        )
      ).status,
    ).toBe("allow");
    expect(readRecentAuditEvents({ workspaceDir: root })[0]).toMatchObject({
      approvalId: id,
      status: "approved",
      devicePort: args[key],
    });
    expect(
      (
        await evaluatePolicy(
          "upload_firmware",
          { ...args, approvalId: id },
          context,
        )
      ).status,
    ).toBe("requires_approval");
  },
);

it.each([
  {
    port: "/dev/cu.usbmodem101",
    uploadPort: "/dev/tty.usbmodem101",
    upload_port: "/dev/cu.usbmodem101",
  },
  { uploadPort: "/dev/tty.usbmodem101", upload_port: "/dev/cu.usbmodem101" },
])(
  "uses the same compatible-selector precedence as execution %j",
  async (selectors) => {
    const args = { projectDir: root, ...selectors };
    const expected = UploadFirmwareParamsSchema.parse(args).port;
    const pending = await evaluatePolicy("upload_firmware", args, caller());
    expect(getApprovalRequestSummary(pending.approvalId!, root)?.port).toBe(
      expected,
    );
    expect(readRecentAuditEvents({ workspaceDir: root })[0]?.devicePort).toBe(
      expected,
    );
  },
);

it("keeps conflicting selectors rejected without changing their raw approval scope", async () => {
  const args = { projectDir: root, port: "COM7", uploadPort: "COM8" };
  const context = caller();
  const expected = approvalScopeDigest(
    "upload_firmware",
    args,
    loadEffectivePolicyState(root).digest,
    context,
  );
  const pending = await evaluatePolicy("upload_firmware", args, context);
  expect(getApproval(pending.approvalId!)?.scopeDigest).toBe(expected);
  expect(getApprovalRequestSummary(pending.approvalId!, root)?.port).toBe(
    "COM7",
  );
  expect(() => UploadFirmwareParamsSchema.parse(args)).toThrow(/Conflicting/);
});

it("does not invent an alias port for other operations", async () => {
  const context = { ...caller(), operationName: "upload_filesystem" };
  const pending = await evaluatePolicy(
    "upload_filesystem",
    { projectDir: root, uploadPort: "COM8" },
    context,
  );
  expect(
    getApprovalRequestSummary(pending.approvalId!, root)?.port,
  ).toBeUndefined();
  expect(
    readRecentAuditEvents({ workspaceDir: root })[0]?.devicePort,
  ).toBeUndefined();
});

it("does not substitute an alias for a present malformed primary selector", async () => {
  const pending = await evaluatePolicy(
    "upload_firmware",
    { projectDir: root, port: false, uploadPort: "COM8" },
    caller(),
  );
  expect(
    getApprovalRequestSummary(pending.approvalId!, root)?.port,
  ).toBeUndefined();
  expect(
    readRecentAuditEvents({ workspaceDir: root })[0]?.devicePort,
  ).toBeUndefined();
});
