/** Environment compatibility report using canonical system, policy and owned-session permissions. */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { execPioCommand } from "../platformio.js";
import { getSystemInfo } from "../tools/projects.js";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import { loadEffectivePolicyState } from "../core/policy/load-policy.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import {
  PlatformIOError,
  PlatformIONotInstalledError,
} from "../utils/errors.js";
import { SERVER_DATA_DIR } from "../utils/paths.js";
import type { SerialClientContext } from "./serial-client.js";
import type { CompatibilityProjectDefaults } from "./compatibility-project.js";
import { projectCompatibilitySession } from "./device-compat.js";

/** Report actual host policy and only caller-owned sessions; missing evidence is never invented. */
export async function executeSystemCompatibility(
  input: unknown,
  client: SerialClientContext,
  serverVersion: string,
  defaults: CompatibilityProjectDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const params = z
    .object({
      approval_id: z.string().max(256).optional(),
      policy_approval_id: z.string().max(256).optional(),
      monitor_approval_id: z.string().max(256).optional(),
    })
    .strict()
    .parse(input);
  const projectDir = await fs.realpath(
    path.resolve(defaults.projectDir ?? defaults.cwd ?? process.cwd()),
  );
  const context = { ...caller, workspaceDir: projectDir };
  const guard = createPolicyRevisionGuard(projectDir);
  const state = await dispatchAuthorizedAction(
    "get_policy_status",
    {
      projectDir,
      approvalId: params.policy_approval_id,
    },
    context,
    async () => loadEffectivePolicyState(projectDir),
  );
  guard();
  return dispatchAuthorizedAction(
    "system_info",
    {
      projectDir,
      approvalId: params.approval_id,
    },
    context,
    async () => {
      await onAuthorized?.();
      guard();
      let version;
      try {
        version = await execPioCommand(["--version"], { timeout: 5000 });
      } catch (error) {
        if (!(error instanceof PlatformIONotInstalledError)) throw error;
        guard();
        return {
          ok: false,
          error: "pio_not_found",
          summary:
            "PlatformIO Core is not installed or not on the server PATH. Install it from https://platformio.org/install/cli.",
          server_version: serverVersion,
          policy: state.profile,
        };
      }
      guard();
      if (version.exitCode !== 0)
        throw new PlatformIOError(
          "PlatformIO version query failed.",
          "SYSTEM_INFO_FAILED",
        );
      const info: unknown = await getSystemInfo();
      guard();
      if (!info || typeof info !== "object" || Array.isArray(info))
        throw new PlatformIOError(
          "Invalid PlatformIO system metadata.",
          "SYSTEM_INFO_INVALID",
        );
      const field = (name: string): string | number | boolean | null => {
        const entry = Object.hasOwn(info, name)
          ? (info as Record<string, unknown>)[name]
          : null;
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
          return null;
        const value = Object.hasOwn(entry, "value")
          ? (entry as { value: unknown }).value
          : null;
        return typeof value === "string"
          ? value.slice(0, 16384)
          : (typeof value === "number" && Number.isFinite(value)) ||
              typeof value === "boolean"
            ? value
            : null;
      };
      const sessions = await client.run(
        { caller: context, approvalId: params.monitor_approval_id },
        (service, owner) => service.listSessions(owner, projectDir),
      );
      guard();
      const obsolete = (version.stdout + version.stderr).includes(
        "Obsolete PIO Core",
      );
      const executable = field("platformio_exe");
      return {
        ok: true,
        summary:
          "PlatformIO Core " +
          field("core_version") +
          " at " +
          executable +
          " (python " +
          field("python_version") +
          ", " +
          field("dev_platform_nums") +
          " platforms installed). Policy: " +
          state.profile +
          "." +
          (obsolete
            ? " Warning: PlatformIO reports an obsolete Core installation; inspect duplicate installations."
            : ""),
        server_version: serverVersion,
        policy: state.profile,
        effective_policy: state.policy,
        pio_command: typeof executable === "string" ? [executable] : null,
        core_version: field("core_version"),
        python: field("python_version"),
        system: field("system"),
        core_dir: field("core_dir"),
        installed_platforms: field("dev_platform_nums"),
        installed_tools: field("package_tool_nums"),
        obsolete_core_warning: obsolete,
        log_dir: path.join(SERVER_DATA_DIR, "command-logs"),
        open_monitor_sessions: sessions
          .filter(
            (session) =>
              !["stopped", "disconnected", "error"].includes(session.state) ||
              session.cleanupPending,
          )
          .map(projectCompatibilitySession),
      };
    },
  );
}
