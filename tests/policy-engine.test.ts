import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { approveRequest } from "../src/core/policy/approvals.js";
import { readRecentAuditEvents } from "../src/core/policy/audit-log.js";
import { evaluatePolicy } from "../src/core/policy/evaluate-policy.js";
import { readAutomationState } from "../src/core/automation-state.js";
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

  it("enforces unattended scope before ordinary approval policy", async () => {
    const scheduledReset = await evaluatePolicy(
      "reset_server_state",
      { projectDir: process.cwd(), automationKey: "nightly-health" },
      {
        workspaceDir: process.cwd(),
        actor: "agent",
        actorClass: "scheduled",
        automationKey: "nightly-health",
      },
    );
    const unboundFlash = await evaluatePolicy(
      "upload_firmware",
      {
        projectDir: process.cwd(),
        environment: "esp32dev",
        automationKey: "nightly-health",
      },
      {
        workspaceDir: process.cwd(),
        actor: "agent",
        actorClass: "scheduled",
        automationKey: "nightly-health",
      },
    );
    const scopedBuild = await evaluatePolicy(
      "build_project",
      {
        projectDir: process.cwd(),
        environment: "native",
        automationKey: "nightly-health",
      },
      {
        workspaceDir: process.cwd(),
        actor: "agent",
        actorClass: "scheduled",
        automationKey: "nightly-health",
      },
    );

    expect(scheduledReset).toMatchObject({
      status: "deny",
      action: "reset_server_state",
    });
    expect(unboundFlash).toMatchObject({
      status: "deny",
      action: "upload_firmware",
    });
    expect(scopedBuild.status).toBe("allow");
  });

  it("atomically enforces the persisted lab-runner write budget", async () => {
    const projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "pio-lab-policy-"),
    );
    try {
      fs.writeFileSync(
        path.join(projectDir, ".pio-mcp-policy.json"),
        JSON.stringify({
          profile: "lab_runner",
          overrides: { audit_all_agent_actions: false },
        }),
        "utf8",
      );
      fs.mkdirSync(path.join(projectDir, ".pio-mcp-workspace"), {
        recursive: true,
      });
      const fingerprint = "f".repeat(64);
      fs.writeFileSync(
        path.join(projectDir, ".pio-mcp-workspace", "automation-policy.json"),
        JSON.stringify({
          enabled: true,
          profile: "lab_runner",
          allowedOperations: ["upload_firmware", "upload_filesystem"],
          environment: "esp32dev",
          deviceFingerprint: fingerprint,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          maxRunDurationSeconds: 300,
          maxConsecutiveFlashes: 2,
          cooldownSeconds: 0,
        }),
        "utf8",
      );
      const binding = {
        digest: "d".repeat(64),
        projectDir,
        environment: "esp32dev",
        board: "esp32dev",
        port: "COM7",
        deviceFingerprint: fingerprint,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
      const args = {
        projectDir,
        environment: "esp32dev",
        targetBinding: binding,
        automationKey: "nightly-hil",
        maxRunDurationSeconds: 300,
      };
      const context = {
        workspaceDir: projectDir,
        actor: "agent" as const,
        actorClass: "scheduled" as const,
        automationKey: "nightly-hil",
      };

      expect(
        await evaluatePolicy("upload_firmware", args, context),
      ).toMatchObject({
        status: "allow",
      });
      expect(readAutomationState(projectDir, "nightly-hil")).toMatchObject({
        consecutiveHardwareWrites: 1,
        lastHardwareWriteAction: "upload_firmware",
      });
      expect(
        await evaluatePolicy("upload_filesystem", args, context),
      ).toMatchObject({
        status: "allow",
      });
      expect(readAutomationState(projectDir, "nightly-hil")).toMatchObject({
        consecutiveHardwareWrites: 2,
        lastHardwareWriteAction: "upload_filesystem",
      });
      expect(
        await evaluatePolicy("upload_firmware", args, context),
      ).toMatchObject({
        status: "deny",
        reason: "The lab-runner consecutive flash limit has been reached.",
      });

      fs.writeFileSync(
        path.join(
          projectDir,
          ".pio-mcp-workspace",
          "automations",
          "nightly-hil.json",
        ),
        "{ malformed",
        "utf8",
      );
      expect(
        await evaluatePolicy("upload_firmware", args, context),
      ).toMatchObject({
        status: "deny",
        reason:
          "Automation 'nightly-hil' state is malformed and requires operator review.",
      });
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
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

    const globalAudit = path.join(
      SERVER_DATA_DIR,
      "audit",
      "global-events.jsonl",
    );
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
