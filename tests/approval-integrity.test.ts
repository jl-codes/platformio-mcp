/** Regression tests for scoped, expiring, single-use approvals. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveRequest,
  consumeApproval,
  createApprovalRequest,
  denyRequest,
  getApproval,
} from "../src/core/policy/approvals.js";
import { evaluatePolicy } from "../src/core/policy/evaluate-policy.js";
import { approvalScopeDigest } from "../src/core/policy/approval-scope.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-approval-grants-"));
  vi.stubEnv("PIO_MCP_DATA_DIR", root);
  vi.stubEnv("PIO_MCP_POLICY_FILE", undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
const digest = "a".repeat(64);
function request() {
  return createApprovalRequest({
    action: "upload_firmware",
    riskLevel: "high",
    reason: "test",
    requestedBy: "agent",
    scopeDigest: digest,
  });
}

describe("approval integrity", () => {
  it("consumes one matching grant and prevents reapproval", () => {
    const pending = request();
    approveRequest(pending.id);
    expect(consumeApproval(pending.id, "b".repeat(64))).toBeUndefined();
    expect(consumeApproval(pending.id, digest)?.status).toBe("consumed");
    expect(consumeApproval(pending.id, digest)).toBeUndefined();
    expect(() => approveRequest(pending.id)).toThrow("consumed");
  });

  it("expires approved requests and cannot revive denied or expired requests", () => {
    const denied = request();
    denyRequest(denied.id);
    expect(() => approveRequest(denied.id)).toThrow("denied");
    const pending = request();
    approveRequest(pending.id);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect(getApproval(pending.id)?.status).toBe("expired");
    expect(consumeApproval(pending.id, digest)).toBeUndefined();
    expect(() => approveRequest(pending.id)).toThrow("expired");
  });

  it("binds every operation parameter and policy revision, with no raw secret persistence", async () => {
    const args = {
      projectDir: root,
      environment: "native",
      port: "COM7",
      auth: "sensitive-secret",
      artifact: { sha256: "original" },
      options: [1, 2],
    };
    const context = { workspaceDir: root, actor: "agent" as const };
    const pending = await evaluatePolicy("upload_firmware", args, context);
    approveRequest(pending.approvalId!);
    expect(
      fs.readFileSync(path.join(root, "approvals.json"), "utf8"),
    ).not.toContain("sensitive-secret");
    for (const changed of [
      { artifact: { sha256: "changed" } },
      { options: [2, 1] },
      { auth: "changed" },
      { extra: true },
    ]) {
      expect(
        (
          await evaluatePolicy(
            "upload_firmware",
            { ...args, ...changed, approvalId: pending.approvalId },
            context,
          )
        ).status,
      ).toBe("requires_approval");
    }
    fs.writeFileSync(
      path.join(root, "policy.yaml"),
      "audit_all_agent_actions: false",
    );
    expect(
      (
        await evaluatePolicy(
          "upload_firmware",
          { ...args, approvalId: pending.approvalId },
          context,
        )
      ).status,
    ).toBe("requires_approval");
    fs.unlinkSync(path.join(root, "policy.yaml"));
    expect(
      (
        await evaluatePolicy(
          "upload_firmware",
          { ...args, approvalId: pending.approvalId },
          context,
        )
      ).status,
    ).toBe("allow");
    expect(
      (
        await evaluatePolicy(
          "upload_firmware",
          { ...args, approvalId: pending.approvalId },
          context,
        )
      ).status,
    ).toBe("requires_approval");
  });

  it("retains consumption if saving the final record fails", () => {
    const pending = request();
    approveRequest(pending.id);
    const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("write failed");
    });
    expect(() => consumeApproval(pending.id, digest)).toThrow("write failed");
    rename.mockRestore();
    expect(getApproval(pending.id)?.status).toBe("consumed");
    expect(consumeApproval(pending.id, digest)).toBeUndefined();
    expect(fs.readdirSync(root).some((name) => name.endsWith(".tmp"))).toBe(
      false,
    );
  });

  it("refuses malformed storage without replacing it", () => {
    fs.writeFileSync(path.join(root, "approvals.json"), "not json");
    expect(() => request()).toThrow("malformed");
    expect(fs.readFileSync(path.join(root, "approvals.json"), "utf8")).toBe(
      "not json",
    );
  });

  it("uses stable JSON order, preserves nested fields and rejects invalid values", () => {
    expect(
      approvalScopeDigest("upload_firmware", { b: 2, a: 1 }, digest, {}),
    ).toBe(
      approvalScopeDigest(
        "upload_firmware",
        { a: 1, b: 2, approvalId: "ignored" },
        digest,
        {},
      ),
    );
    expect(
      approvalScopeDigest(
        "upload_firmware",
        { nested: { approved: true } },
        digest,
        {},
      ),
    ).not.toBe(
      approvalScopeDigest(
        "upload_firmware",
        { nested: { approved: false } },
        digest,
        {},
      ),
    );
    expect(() =>
      approvalScopeDigest("upload_firmware", { timeout: Infinity }, digest, {}),
    ).toThrow("finite JSON");
  });

  it("allows exactly one competing process to consume a grant", async () => {
    const pending = request();
    approveRequest(pending.id);
    const worker = path.resolve("tests/fixtures/approval-consumer.ts");
    const run = () =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", worker, pending.id, digest],
          {
            env: { ...process.env, PIO_MCP_DATA_DIR: root },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
          },
        );
        let output = "";
        let errors = "";
        child.stdout.on("data", (data) => {
          output += data;
        });
        child.stderr.on("data", (data) => {
          errors += data;
        });
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0 ? resolve(output.trim()) : reject(new Error(errors)),
        );
      });
    const results = await Promise.all([run(), run(), run(), run()]);
    expect(results.filter((result) => result === "consumed")).toHaveLength(1);
    expect(results.filter((result) => result === "unavailable")).toHaveLength(
      3,
    );
  }, 15_000);
});
