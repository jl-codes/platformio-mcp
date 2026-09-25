/**
 * Shared authorized project/environment and target-discovery handlers.
 * Provides executeProjectInspection for MCP and CLI without changing legacy response contracts.
 */
import fs from "node:fs/promises";
import { z } from "zod";
import { platformioExecutor } from "../platformio.js";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import {
  parseProjectEnvironments,
  parseProjectMetadata,
} from "../core/project-inspection.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { redactSecretsInText } from "../core/policy/redact.js";
import { PlatformIOError } from "../utils/errors.js";

/** Implemented canonical project inspection operations. */
export type ProjectInspectionAction =
  | "project_envs"
  | "project_metadata"
  | "list_targets";
const base = {
  projectDir: z.string().min(1).max(32768),
  approvalId: z.string().optional(),
};
const envSchema = z.object(base).strict();
const metadataSchema = z
  .object({
    ...base,
    environment: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/)
      .optional(),
  })
  .strict();

/**
 * Read resolved configuration or generate build metadata under the correct permission category.
 * Metadata/target discovery can run project scripts and install dependencies; it is not read-only.
 */
export async function executeProjectInspection(
  action: ProjectInspectionAction,
  input: unknown,
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  if (!["project_envs", "project_metadata", "list_targets"].includes(action))
    throw new PlatformIOError(
      "Unknown project inspection operation.",
      "UNKNOWN_ACTION",
    );
  const parsed =
    action === "project_envs"
      ? envSchema.parse(input)
      : metadataSchema.parse(input);
  const projectDir = await fs.realpath(parsed.projectDir);
  const params = { ...parsed, projectDir };
  const environment =
    "environment" in parsed
      ? (parsed.environment as string | undefined)
      : undefined;
  return dispatchAuthorizedAction(
    action,
    params,
    { ...caller, workspaceDir: projectDir },
    async () => {
      const check = createPolicyRevisionGuard(projectDir);
      await onAuthorized?.();
      check();
      const args = [
        action === "project_envs" ? "config" : "metadata",
        "--json-output",
        "--project-dir",
        projectDir,
      ];
      if (environment) args.push("--environment", environment);
      const result = await platformioExecutor.execute("project", args, {
        cwd: projectDir,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        timeout: action === "project_envs" ? 30000 : 600000,
      });
      check();
      if (result.exitCode !== 0)
        return {
          ok: false,
          exitCode: result.exitCode,
          projectDir,
          summary: `${action} failed; see outputTail.`,
          outputTail: redactSecretsInText(
            [result.stdout, result.stderr].join("\n"),
          )
            .split(/\r?\n/)
            .slice(-40)
            .join("\n")
            .slice(-32768),
        };
      if (action === "project_envs") {
        const report = parseProjectEnvironments(result.stdout);
        return {
          ok: true,
          exitCode: 0,
          projectDir,
          ...report,
          summary: `${report.envs.length} resolved environment(s); defaults: ${report.defaultEnvironments.join(", ") || "none"}.`,
        };
      }
      const report = parseProjectMetadata(result.stdout, environment);
      if (action === "list_targets")
        return {
          ok: report.targetsAvailable,
          exitCode: 0,
          projectDir,
          targets: report.targets,
          environments: Object.keys(report.envs),
          summary: report.targetsAvailable
            ? `${report.targets.length} build target(s) from PlatformIO metadata.`
            : "This metadata does not expose a target inventory.",
          ...(!report.targetsAvailable ? { error: "TARGETS_UNAVAILABLE" } : {}),
        };
      return {
        ok: true,
        exitCode: 0,
        projectDir,
        envs: report.envs,
        summary: `Build metadata for ${Object.keys(report.envs).join(", ")}.`,
      };
    },
  );
}
