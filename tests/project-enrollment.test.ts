/** Project grants require operator enrollment and cannot defeat operator restrictions. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  enrollProjectPolicy,
  revokeProjectPolicy,
} from "../src/core/policy/project-enrollment.js";
import { loadEffectivePolicyState } from "../src/core/policy/load-policy.js";
import { evaluatePolicy } from "../src/core/policy/evaluate-policy.js";
let root: string, project: string, operator: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-enrollment-"));
  project = path.join(root, "project");
  operator = path.join(root, "operator");
  fs.mkdirSync(project);
  fs.mkdirSync(operator);
  vi.stubEnv("PIO_MCP_DATA_DIR", operator);
  vi.stubEnv("PIO_MCP_POLICY_FILE", undefined);
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    JSON.stringify({ profile: "lab_admin" }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
const upload = () =>
  evaluatePolicy(
    "upload_firmware",
    { projectDir: project },
    { workspaceDir: project },
  );
describe("operator project enrollment", () => {
  it("supports explicit operator CLI enrollment and revocation", () => {
    const run = (command: string) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            "--import",
            "tsx",
            "src/cli.ts",
            command,
            "--project-dir",
            project,
            "--json",
          ],
          {
            cwd: process.cwd(),
            env: process.env,
            encoding: "utf8",
            timeout: 15000,
          },
        ),
      );
    expect(run("policy-enroll").digest).toMatch(/^[a-f0-9]{64}$/);
    expect(loadEffectivePolicyState(project).projectEnrollment?.enrolled).toBe(
      true,
    );
    expect(run("policy-revoke")).toEqual({ revoked: true });
    expect(loadEffectivePolicyState(project).projectEnrollment?.enrolled).toBe(
      false,
    );
  });
  it("retains approval until enrollment, then restores lab_admin behavior", async () => {
    expect((await upload()).status).toBe("requires_approval");
    expect(loadEffectivePolicyState(project).projectEnrollment?.enrolled).toBe(
      false,
    );
    enrollProjectPolicy(project);
    expect((await upload()).status).toBe("allow");
    expect(loadEffectivePolicyState(project).projectEnrollment?.enrolled).toBe(
      true,
    );
  });
  it("invalidates changes to either policy source and revocation", async () => {
    enrollProjectPolicy(project);
    fs.mkdirSync(path.join(project, ".pio-mcp-workspace"));
    fs.writeFileSync(
      path.join(project, ".pio-mcp-workspace/policy.yaml"),
      "audit_all_agent_actions: false",
    );
    expect((await upload()).status).toBe("requires_approval");
    expect(
      loadEffectivePolicyState(project).policy.audit_all_agent_actions,
    ).toBe(true);
    enrollProjectPolicy(project);
    expect(
      loadEffectivePolicyState(project).policy.audit_all_agent_actions,
    ).toBe(false);
    revokeProjectPolicy(project);
    expect((await upload()).status).toBe("requires_approval");
  });
  it("normalizes formatting but rejects changed profile contents", () => {
    enrollProjectPolicy(project);
    fs.writeFileSync(
      path.join(project, ".pio-mcp-policy.json"),
      '{ "profile" : "lab_admin" }',
    );
    expect(loadEffectivePolicyState(project).projectEnrollment?.enrolled).toBe(
      true,
    );
    fs.writeFileSync(
      path.join(project, ".pio-mcp-policy.json"),
      '{"profile":"lab_runner"}',
    );
    expect(loadEffectivePolicyState(project).projectEnrollment?.enrolled).toBe(
      false,
    );
  });
  it("does not enroll a copy at another path", () => {
    enrollProjectPolicy(project);
    const copy = path.join(root, "copy");
    fs.mkdirSync(copy);
    fs.copyFileSync(
      path.join(project, ".pio-mcp-policy.json"),
      path.join(copy, ".pio-mcp-policy.json"),
    );
    expect(loadEffectivePolicyState(copy).projectEnrollment?.enrolled).toBe(
      false,
    );
  });
  it("applies restrictive policy without enrollment", async () => {
    fs.writeFileSync(
      path.join(project, ".pio-mcp-policy.json"),
      '{"profile":"read_only"}',
    );
    expect(
      (
        await evaluatePolicy(
          "build_project",
          { projectDir: project },
          { workspaceDir: project },
        )
      ).status,
    ).toBe("deny");
  });
  it("preserves operator restrictions even after enrollment", async () => {
    fs.writeFileSync(
      path.join(operator, "policy.yaml"),
      "deny: [upload_firmware]",
    );
    enrollProjectPolicy(project);
    expect((await upload()).status).toBe("deny");
  });
  it("rejects project-local enrollment storage including directory aliases", () => {
    const alias = path.join(root, "alias");
    fs.symlinkSync(project, alias, "junction");
    vi.stubEnv("PIO_MCP_DATA_DIR", alias);
    expect(() => enrollProjectPolicy(project)).toThrow("outside the project");
  });
  it("fails closed for corrupted enrollment records", () => {
    enrollProjectPolicy(project);
    const directory = path.join(operator, "project-enrollments");
    fs.writeFileSync(
      path.join(directory, fs.readdirSync(directory)[0]),
      "broken",
    );
    expect(() => loadEffectivePolicyState(project)).toThrow(
      "Invalid or unreadable enrollment",
    );
    revokeProjectPolicy(project);
    expect(loadEffectivePolicyState(project).projectEnrollment?.enrolled).toBe(
      false,
    );
  });
});
