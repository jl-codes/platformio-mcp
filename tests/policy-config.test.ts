import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parsePolicyDocument,
  PolicyConfigError,
} from "../src/core/policy/policy-schema.js";
import { loadEffectivePolicyState } from "../src/core/policy/load-policy.js";
import { getPolicyStatus } from "../src/core/policy/status.js";
import { evaluatePolicy } from "../src/core/policy/evaluate-policy.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-policy-config-"));
  vi.stubEnv("PIO_MCP_DATA_DIR", root);
  vi.stubEnv("PIO_MCP_POLICY_FILE", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("strict policy configuration", () => {
  it.each([
    ['{"allow": [], "allow": ["build_project"]}', "policy.json"],
    ["allow: []\nallow: [build_project]", "policy.yaml"],
    ["allow: [build_project]", "policy.json"],
    ['{"profile":"typo"}', "policy.json"],
    ['{"allow":["unknown_action"]}', "policy.json"],
    ['{"require_workspace_boundary":"false"}', "policy.json"],
    ['{"alow":[]}', "policy.json"],
    ["allow: &actions []\ndeny: *actions", "policy.yaml"],
    ["---\nallow: []\n---\ndeny: []", "policy.yaml"],
  ])("rejects ambiguous or invalid input %s", (text, source) => {
    expect(() => parsePolicyDocument(text, source)).toThrow(PolicyConfigError);
  });

  it("uses missing optional defaults without creating files", () => {
    const state = loadEffectivePolicyState(root);
    expect(state.profile).toBe("flash_requires_approval");
    expect(state.sources.filter((source) => source.present)).toHaveLength(1);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("reports explicit missing configuration and denies execution", async () => {
    vi.stubEnv("PIO_MCP_POLICY_FILE", path.join(root, "missing.json"));
    expect(getPolicyStatus(root)).toMatchObject({
      valid: false,
      profile: "invalid",
    });
    expect(
      (
        await evaluatePolicy(
          "build_project",
          { projectDir: root },
          { workspaceDir: root, actor: "agent" },
        )
      ).status,
    ).toBe("deny");
    expect(
      (
        await evaluatePolicy(
          "get_policy_status",
          { projectDir: root },
          { workspaceDir: root, actor: "agent" },
        )
      ).status,
    ).toBe("allow");
  });

  it("never refills an explicitly empty allow list", async () => {
    fs.writeFileSync(
      path.join(root, "policy.yaml"),
      "allow: []\napproval_required: []",
    );
    expect(
      (
        await evaluatePolicy(
          "build_project",
          { projectDir: root },
          { workspaceDir: root, actor: "agent" },
        )
      ).status,
    ).toBe("deny");
  });

  it("preserves operator restrictions against project overrides", () => {
    fs.writeFileSync(
      path.join(root, "policy.yaml"),
      "allow: [build_project]\napproval_required: [upload_firmware]\ndeny: [erase_flash]\nrequire_workspace_boundary: true",
    );
    fs.mkdirSync(path.join(root, ".pio-mcp-workspace"));
    fs.writeFileSync(
      path.join(root, ".pio-mcp-workspace", "policy.yaml"),
      "allow: [build_project, upload_firmware, erase_flash]\napproval_required: []\ndeny: []\nrequire_workspace_boundary: false",
    );
    const state = loadEffectivePolicyState(root);
    expect(state.policy.allow).not.toContain("erase_flash");
    expect(state.policy.deny).toContain("erase_flash");
    expect(state.policy.approval_required).toContain("upload_firmware");
    expect(state.policy.require_workspace_boundary).toBe(true);
  });

  it("exposes deterministic provenance that changes with policy content", () => {
    const first = getPolicyStatus(root);
    expect(first.valid).toBe(true);
    expect(first.digest).toBe(getPolicyStatus(root).digest);
    fs.writeFileSync(path.join(root, "policy.yaml"), "allow: []");
    const second = getPolicyStatus(root);
    expect(second.digest).not.toBe(first.digest);
    expect(
      second.sources.find((source) => source.kind === "operator")?.sha256,
    ).toMatch(/^[a-f0-9]{64}$/);
  });
});
