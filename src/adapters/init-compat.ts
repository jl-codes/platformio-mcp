/** Authorized reference project initialization with bounded configuration disclosure. */
import { retainCommandLog } from "../utils/command-log.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { initProject } from "../tools/projects.js";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import { redactSecretsInText } from "../core/policy/redact.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import type { CompatibilityProjectDefaults } from "./compatibility-project.js";
import { PlatformIOError, ProjectInitError } from "../utils/errors.js";

/** Authorize initialization and returned configuration separately before creating the destination. */
export async function executeInitCompatibility(
  input: unknown,
  defaults: CompatibilityProjectDefaults,
  caller: PolicyEvaluationContext,
  onAuthorized?: () => Promise<void>,
) {
  const params = z
    .object({
      project_dir: z.string().min(1).max(32768),
      board: z.string().min(1).max(256),
      framework: z.string().max(256).nullable().optional(),
      project_options: z
        .array(z.string().min(1).max(4096))
        .max(128)
        .nullable()
        .optional(),
      approval_id: z.string().max(256).optional(),
      config_approval_id: z.string().max(256).optional(),
    })
    .strict()
    .parse(input);
  let requested = params.project_dir;
  if (
    requested === "~" ||
    requested.startsWith("~/") ||
    requested.startsWith("~\\")
  )
    requested = path.join(defaults.home ?? os.homedir(), requested.slice(2));
  else if (requested.startsWith("~"))
    throw new PlatformIOError(
      "Named-user home expansion is unsupported.",
      "COMPAT_PROJECT_INVALID",
    );
  const projectDir = path.resolve(defaults.cwd ?? process.cwd(), requested);
  const config = {
    board: params.board,
    framework: params.framework || undefined,
    projectDir,
    projectOptions: params.project_options ?? [],
  };
  const context = { ...caller, workspaceDir: projectDir };
  return dispatchAuthorizedAction(
    "get_project_config",
    { projectDir, approvalId: params.config_approval_id },
    context,
    () =>
      dispatchAuthorizedAction(
        "init_project",
        { ...config, approvalId: params.approval_id },
        context,
        async () => {
          const guard = createPolicyRevisionGuard(projectDir);
          await onAuthorized?.();
          guard();
          let logPath: string | null = null;
          let result;
          try {
            result = await initProject(config, {
              timeoutMs: 600000,
              onResult: async (execution) => {
                guard();
                logPath = await retainCommandLog(
                  "initialization",
                  execution.stdout,
                  execution.stderr,
                );
              },
            });
          } catch (error) {
            guard();
            if (
              error instanceof ProjectInitError &&
              typeof error.context?.exitCode === "number"
            ) {
              return {
                ok: false,
                error: "init_failed",
                summary: `pio project init failed (exit ${error.context.exitCode}).`,
                output: redactSecretsInText(
                  String(error.context.stdout ?? "") +
                    "\n" +
                    String(error.context.stderr ?? ""),
                ).slice(-2000),
                log_path: logPath,
              };
            }
            throw error;
          }
          guard();
          const root = await fs.realpath(result.path);
          let ini = "";
          try {
            const filename = await fs.realpath(
              path.join(root, "platformio.ini"),
            );
            if (path.dirname(filename) !== root)
              throw new PlatformIOError(
                "Generated configuration escapes the project.",
                "COMPAT_PROJECT_INVALID",
              );
            const file = await fs.open(filename, "r");
            try {
              const stat = await file.stat();
              if (!stat.isFile() || stat.size > 1048576)
                throw new PlatformIOError(
                  "Generated configuration exceeds report limits.",
                  "COMPAT_RESULT_LIMIT",
                );
              const buffer = Buffer.alloc(1048577);
              const { bytesRead } = await file.read(
                buffer,
                0,
                buffer.length,
                0,
              );
              if (bytesRead > 1048576)
                throw new PlatformIOError(
                  "Generated configuration exceeds report limits.",
                  "COMPAT_RESULT_LIMIT",
                );
              ini = redactSecretsInText(
                buffer.subarray(0, bytesRead).toString("utf8"),
              );
            } finally {
              await file.close();
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          const items = (
            await fs.readdir(root, { withFileTypes: true })
          ).filter((item) => !item.name.startsWith("."));
          if (items.length > 4096)
            throw new PlatformIOError(
              "Project layout exceeds report limits.",
              "COMPAT_RESULT_LIMIT",
            );
          guard();
          return {
            ok: result.success,
            summary: `Project ready at ${root} for board ${params.board}. Put source files in src/.`,
            project_dir: root,
            platformio_ini: ini,
            layout: items
              .map((item) => item.name + (item.isDirectory() ? "/" : ""))
              .sort(),
            log_path: logPath,
          };
        },
      ),
  );
}
