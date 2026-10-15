import { enrollProjectPolicy } from "../src/core/policy/project-enrollment.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluatePolicy } from "../src/core/policy/evaluate-policy.js";
import { getPolicyStatus } from "../src/core/policy/status.js";
import { resolvePolicyProfile } from "../src/core/policy/profiles.js";
import { uploadFirmwareCore } from "../src/core/flash.js";
import * as uploadModule from "../src/tools/upload.js";
import * as targetModule from "../src/core/target-resolution.js";

const createdDirs: string[] = [];

function makeTempWorkspace(profile: object): string {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "pio-policy-profile-"),
  );
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
    vi.restoreAllMocks();
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

    enrollProjectPolicy(workspace);
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

  it("resolves standalone profile with relaxed boundaries and no approvals", () => {
    const config = resolvePolicyProfile({ profile: "standalone" });
    expect(config.approval_required).toEqual([]);
    expect(config.require_workspace_boundary).toBe(false);
    expect(config.require_device_lock_for_upload).toBe(false);
  });

  it("enforces standalone profile allowing operations without approval while denying catastrophic actions", async () => {
    const workspace = makeTempWorkspace({
      profile: "standalone",
      overrides: { audit_all_agent_actions: false },
    });

    enrollProjectPolicy(workspace);

    const uploadDecision = await evaluatePolicy(
      "upload_firmware",
      { projectDir: workspace },
      { workspaceDir: workspace, actor: "agent" },
    );
    const buildDecision = await evaluatePolicy(
      "build_project",
      { projectDir: workspace },
      { workspaceDir: workspace, actor: "agent" },
    );
    const resetDecision = await evaluatePolicy(
      "reset_server_state",
      { projectDir: workspace },
      { workspaceDir: workspace, actor: "agent" },
    );
    const eraseDecision = await evaluatePolicy(
      "erase_flash",
      { projectDir: workspace },
      { workspaceDir: workspace, actor: "agent" },
    );

    expect(uploadDecision.status).toBe("allow");
    expect(buildDecision.status).toBe("allow");
    expect(resetDecision.status).toBe("allow");
    expect(eraseDecision.status).toBe("deny");
  });

  it("bypasses target resolution in uploadFirmwareCore when standalone profile with explicit env and port", async () => {
    const workspace = makeTempWorkspace({
      profile: "standalone",
      overrides: { audit_all_agent_actions: false },
    });
    enrollProjectPolicy(workspace);

    const uploadSpy = vi.spyOn(uploadModule, "uploadFirmware").mockResolvedValue({
      success: true,
      message: "Uploaded",
    });
    const resolveSpy = vi.spyOn(targetModule, "resolveWriteTarget");

    const result = await uploadFirmwareCore({
      projectDir: workspace,
      environment: "esp32dev",
      port: "/dev/ttyUSB0",
    });

    expect(result.success).toBe(true);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(uploadSpy).toHaveBeenCalledWith(
      workspace,
      "/dev/ttyUSB0",
      "esp32dev",
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it("invokes target resolution in uploadFirmwareCore when profile is not standalone", async () => {
    const workspace = makeTempWorkspace({
      profile: "flash_requires_approval",
      overrides: { audit_all_agent_actions: false },
    });
    enrollProjectPolicy(workspace);

    vi.spyOn(uploadModule, "uploadFirmware").mockResolvedValue({
      success: true,
      message: "Uploaded",
    });
    const resolveSpy = vi.spyOn(targetModule, "resolveWriteTarget").mockResolvedValue({
      environment: "esp32dev",
      port: "/dev/ttyUSB0",
      binding: { digest: "mock" } as unknown as targetModule.TargetBinding,
      portChanged: false,
    });

    const result = await uploadFirmwareCore({
      projectDir: workspace,
      environment: "esp32dev",
      port: "/dev/ttyUSB0",
    });

    expect(result.success).toBe(true);
    expect(resolveSpy).toHaveBeenCalled();
  });

  it("falls back to resolveWriteTarget in standalone when port is missing", async () => {
    const workspace = makeTempWorkspace({ profile: "standalone" });
    enrollProjectPolicy(workspace);

    vi.spyOn(uploadModule, "uploadFirmware").mockResolvedValue({
      success: true,
      message: "Uploaded",
    });
    const resolveSpy = vi.spyOn(targetModule, "resolveWriteTarget").mockResolvedValue({
      environment: "esp32dev",
      port: "/dev/ttyUSB0",
      binding: { digest: "mock" } as unknown as targetModule.TargetBinding,
      portChanged: false,
    });

    const result = await uploadFirmwareCore({
      projectDir: workspace,
      environment: "esp32dev",
      // port intentionally omitted
    });

    expect(result.success).toBe(true);
    expect(resolveSpy).toHaveBeenCalled();
  });

  it("normalizes /dev/tty.* port in standalone bypass", async () => {
    const workspace = makeTempWorkspace({ profile: "standalone" });
    enrollProjectPolicy(workspace);

    const uploadSpy = vi.spyOn(uploadModule, "uploadFirmware").mockResolvedValue({
      success: true,
      message: "Uploaded",
    });

    await uploadFirmwareCore({
      projectDir: workspace,
      environment: "esp32dev",
      port: "/dev/tty.usbmodem101",
    });

    // Should be normalised to /dev/cu.usbmodem101
    expect(uploadSpy).toHaveBeenCalledWith(
      workspace,
      "/dev/cu.usbmodem101",
      "esp32dev",
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });
});
