import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/core/policy/evaluate-policy.js";
import { getPolicyStatus } from "../src/core/policy/status.js";

const createdDirs: string[] = [];

function makeTempWorkspace(profile: object): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pio-policy-profile-"));
  createdDirs.push(workspace);
  fs.writeFileSync(
    path.join(workspace, ".pio-mcp-policy.json"),
    JSON.stringify(profile, null, 2),
    "utf8",
  );
  return workspace;
}

describe("Policy Profiles", () => {
  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("enforces read_only profile by denying build/upload", async () => {
    const workspace = makeTempWorkspace({
      profile: "read_only",
      overrides: { audit_all_agent_actions: false },
    });

    const buildDecision = await evaluatePolicy(
      "build_project",
      { projectDir: workspace },
      { workspaceDir: workspace, actor: "agent" },
    );
    const uploadDecision = await evaluatePolicy(
      "upload_firmware",
      { projectDir: workspace },
      { workspaceDir: workspace, actor: "agent" },
    );

    expect(buildDecision.status).toBe("deny");
    expect(uploadDecision.status).toBe("deny");
  });

  it("enforces build_only profile (build allowed, upload denied)", async () => {
    const workspace = makeTempWorkspace({
      profile: "build_only",
      overrides: { audit_all_agent_actions: false },
    });

    const buildDecision = await evaluatePolicy(
      "build_project",
      { projectDir: workspace },
      { workspaceDir: workspace, actor: "agent" },
    );
    const uploadDecision = await evaluatePolicy(
      "upload_firmware",
      { projectDir: workspace },
      { workspaceDir: workspace, actor: "agent" },
    );

    expect(buildDecision.status).toBe("allow");
    expect(uploadDecision.status).toBe("deny");
  });

  it("enforces lab_admin profile and exposes policy status", async () => {
    const workspace = makeTempWorkspace({
      profile: "lab_admin",
      overrides: { audit_all_agent_actions: false },
    });

    const uploadDecision = await evaluatePolicy(
      "upload_firmware",
      { projectDir: workspace },
      { workspaceDir: workspace, actor: "agent" },
    );
    const status = getPolicyStatus(workspace);

    expect(uploadDecision.status).toBe("allow");
    expect(status.profile).toBe("lab_admin");
    expect(status.approvalRequiredOperations.length).toBe(0);
  });
});
