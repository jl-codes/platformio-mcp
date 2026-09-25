/** Target authorization prevents builds and custom names from bypassing upload/erase policy. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  classifyTargetEffects,
  dispatchAuthorizedTarget,
} from "../src/core/target-effects.js";
import { policyNamesForOperation } from "../src/core/action-catalog.js";

let project: string;
beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "pio-target-policy-"));
  fs.writeFileSync(
    path.join(project, "platformio.ini"),
    "[env:native]\nplatform=native\n",
  );
});
afterEach(() => fs.rmSync(project, { recursive: true, force: true }));
function policy(profile: string) {
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile,
      overrides: { audit_all_agent_actions: false },
    }),
  );
}
it.each([
  ["buildfs", "build_project", "none"],
  ["clean", "clean_project", "none"],
  ["fullclean", "clean_project", "none"],
  ["upload", "upload_firmware", "write"],
  ["uploadfs", "upload_filesystem", "write"],
  ["erase", "erase_flash", "write"],
  ["build-and-flash", "run_shell_command", "unknown"],
  ["buildfs,upload", "run_shell_command", "unknown"],
  ["Upload", "run_shell_command", "unknown"],
])("classifies exact target %s as %s", (target, action, deviceAccess) => {
  const effects = classifyTargetEffects(target);
  expect(effects.deviceAccess).toBe(deviceAccess);
  expect(policyNamesForOperation(effects.operation).at(-1)).toBe(action);
});
it.each(["upload", "uploadfs", "erase", "custom-build", "buildfs,upload"])(
  "build_only rejects %s before execution",
  async (target) => {
    policy("build_only");
    const execute = vi.fn();
    await expect(
      dispatchAuthorizedTarget(
        target,
        { projectDir: project },
        { workspaceDir: project },
        execute,
      ),
    ).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(execute).not.toHaveBeenCalled();
  },
);
it("build_only allows an authorized filesystem build", async () => {
  policy("build_only");
  const execute = vi.fn(async (effects) => effects.effect);
  await expect(
    dispatchAuthorizedTarget(
      "buildfs",
      { projectDir: project },
      { workspaceDir: project },
      execute,
    ),
  ).resolves.toBe("build");
  expect(execute).toHaveBeenCalledOnce();
});
it("read_only rejects project-code execution", async () => {
  policy("read_only");
  const execute = vi.fn();
  await expect(
    dispatchAuthorizedTarget(
      "buildfs",
      { projectDir: project },
      { workspaceDir: project },
      execute,
    ),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(execute).not.toHaveBeenCalled();
});
it("a concrete target denial is not bypassed by its allowed build category", async () => {
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "build_only",
      deny: ["target_build"],
      overrides: { audit_all_agent_actions: false },
    }),
  );
  const execute = vi.fn();
  await expect(
    dispatchAuthorizedTarget(
      "buildfs",
      { projectDir: project },
      { workspaceDir: project },
      execute,
    ),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(execute).not.toHaveBeenCalled();
});

it.each(["read_only", "build_only", "monitor_only"])(
  "%s denies erase and arbitrary project code rather than offering approval",
  async (profile) => {
    policy(profile);
    for (const target of ["erase", "custom-target"]) {
      const execute = vi.fn();
      await expect(
        dispatchAuthorizedTarget(
          target,
          { projectDir: project },
          { workspaceDir: project },
          execute,
        ),
      ).rejects.toMatchObject({ code: "POLICY_DENIED" });
      expect(execute).not.toHaveBeenCalled();
    }
  },
);
it.each(["", "--upload", "build\n--target upload"])(
  "rejects malformed target %j",
  (target) => {
    expect(() => classifyTargetEffects(target)).toThrow("Invalid named target");
  },
);
