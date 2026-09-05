import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { approveRequest } from "../src/core/policy/approvals.js";
import { readRecentAuditEvents } from "../src/core/policy/audit-log.js";
import { evaluatePolicy } from "../src/core/policy/evaluate-policy.js";
import { redactSecretsInText } from "../src/core/policy/redact.js";
import { SERVER_DATA_DIR } from "../src/utils/paths.js";

function removeIfExists(target: string) {
  if (!fs.existsSync(target)) return;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  if (fs.existsSync(target) && lastError) {
    throw lastError;
  }
}

describe("Policy Engine", () => {
  beforeEach(() => {
    removeIfExists(path.join(SERVER_DATA_DIR, "approvals.json"));
    removeIfExists(path.join(SERVER_DATA_DIR, "audit"));
  });

  it("requires approval for firmware upload", async () => {
    const decision = await evaluatePolicy(
      "upload_firmware",
      { projectDir: process.cwd() },
      { workspaceDir: process.cwd(), actor: "agent" },
    );

    expect(decision.status).toBe("requires_approval");
    expect(decision.riskLevel).toBe("high");
    expect(decision.approvalId).toBeDefined();
  });

  it("allows firmware upload after explicit approval flag", async () => {
    const decision = await evaluatePolicy(
      "upload_firmware",
      { projectDir: process.cwd(), __approved: true },
      { workspaceDir: process.cwd(), actor: "user" },
    );

    expect(decision.status).toBe("allow");
    expect(decision.approvalId).toBeDefined();
  });

  it("does not allow an agent to self-approve with an inline flag", async () => {
    const decision = await evaluatePolicy(
      "upload_firmware",
      { projectDir: process.cwd(), __approved: true },
      { workspaceDir: process.cwd(), actor: "agent" },
    );

    expect(decision.status).toBe("requires_approval");
    expect(decision.approvalId).toBeDefined();
  });

  it("does not replay an approval for another project or action", async () => {
    const requested = await evaluatePolicy(
      "upload_firmware",
      { projectDir: process.cwd(), environment: "esp32dev", port: "COM7" },
      { workspaceDir: process.cwd(), actor: "agent" },
    );
    approveRequest(requested.approvalId!);

    const wrongProject = await evaluatePolicy(
      "upload_firmware",
      {
        projectDir: path.join(process.cwd(), "another-project"),
        environment: "esp32dev",
        port: "COM7",
        approvalId: requested.approvalId,
      },
      { workspaceDir: process.cwd(), actor: "agent" },
    );
    const wrongAction = await evaluatePolicy(
      "upload_filesystem",
      {
        projectDir: process.cwd(),
        environment: "esp32dev",
        port: "COM7",
        approvalId: requested.approvalId,
      },
      { workspaceDir: process.cwd(), actor: "agent" },
    );

    expect(wrongProject.status).toBe("requires_approval");
    expect(wrongAction.status).toBe("requires_approval");
  });

  it("denies known dangerous actions", async () => {
    const decision = await evaluatePolicy(
      "curl_pipe_to_shell",
      {},
      { workspaceDir: process.cwd(), actor: "agent" },
    );

    expect(decision.status).toBe("deny");
    expect(decision.riskLevel).toBe("medium");
  });

  it("writes audit events", async () => {
    await evaluatePolicy(
      "list_devices",
      {},
      { workspaceDir: process.cwd(), actor: "agent" },
    );

    const globalAudit = path.join(SERVER_DATA_DIR, "audit", "global-events.jsonl");
    const localAudit = path.join(
      process.cwd(),
      ".pio-mcp-workspace",
      "audit",
      "events.jsonl",
    );

    expect(fs.existsSync(globalAudit)).toBe(true);
    expect(fs.existsSync(localAudit)).toBe(true);
    const lines = fs
      .readFileSync(globalAudit, "utf8")
      .split(/\r?\n/)
      .filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    expect(readRecentAuditEvents({ limit: 1 })[0]).toMatchObject({
      policyProfile: "flash_requires_approval",
      actorClass: "interactive",
    });
  });

  it("redacts common secret patterns", () => {
    const raw =
      "OPENAI_API_KEY=sk-test-abc password = supersecret token=abc123";
    const redacted = redactSecretsInText(raw);
    expect(redacted).not.toContain("sk-test-abc");
    expect(redacted).not.toContain("supersecret");
    expect(redacted).not.toContain("abc123");
    expect(redacted).toContain("[REDACTED_SECRET]");
  });
});
