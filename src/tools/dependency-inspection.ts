/** Authorized dependency inventory and optional build evidence, shared by future public adapters. */
import { parseDependencyGraph } from "../core/dependency-graph.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { executeProjectInspection } from "./project-inspection.js";
import { dependencyProjectInputs } from "../core/dependency-project.js";
import { collectDependencyInventory } from "../core/dependency-inventory.js";
import { auditDependencies } from "../core/dependency-audit.js";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { redactSecretsInText } from "../core/policy/redact.js";
import { platformioExecutor } from "../platformio.js";
import { PlatformIOError } from "../utils/errors.js";

const schema = z
  .object({
    projectDir: z.string().min(1).max(32768),
    environment: z
      .string()
      .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,49}$/)
      .optional(),
    build: z.boolean().default(false),
    configurationApprovalId: z.string().max(256).optional(),
    inventoryApprovalId: z.string().max(256).optional(),
    buildApprovalId: z.string().max(256).optional(),
  })
  .strict();
/** Run distinct configuration, inventory and optional build permissions; never reuse an approval across stages. */
export async function inspectDependencies(
  input: unknown,
  caller: PolicyEvaluationContext = {},
) {
  const parsed = schema.parse(input);
  const projectDir = await fs.realpath(parsed.projectDir);
  const check = createPolicyRevisionGuard(projectDir);
  const context = { ...caller, workspaceDir: projectDir };
  const configuration = await executeProjectInspection(
    "project_envs",
    { projectDir, approvalId: parsed.configurationApprovalId },
    context,
  );
  check();
  if (!configuration.ok || !("defaultEnvironments" in configuration))
    throw new PlatformIOError(
      "Cannot audit dependencies without resolved configuration.",
      "DEPENDENCY_CONFIG_UNAVAILABLE",
    );
  const selected = dependencyProjectInputs(
    projectDir,
    configuration,
    parsed.environment,
  );
  const inventory = await dispatchAuthorizedAction(
    "dependency_inventory",
    {
      projectDir,
      environment: selected.environment,
      roots: selected.roots,
      approvalId: parsed.inventoryApprovalId,
    },
    context,
    async () => {
      check();
      const roots = await Promise.all(
        selected.roots.map(async (root) => {
          try {
            return { ...root, directory: await fs.realpath(root.directory) };
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return root;
            throw error;
          }
        }),
      );
      const allowed = roots.map((root) => path.resolve(root.directory));
      const assertAuthorized = (target: string) => {
        check();
        if (
          !allowed.some((root) => {
            const relative = path.relative(root, target);
            return (
              relative === "" ||
              (!relative.startsWith(`..${path.sep}`) &&
                relative !== ".." &&
                !path.isAbsolute(relative))
            );
          })
        )
          throw new PlatformIOError(
            "Library path moved outside the authorized roots.",
            "DEPENDENCY_SCOPE_CHANGED",
          );
      };
      return collectDependencyInventory(roots, assertAuthorized);
    },
  );
  check();
  let graphEvidence: ReturnType<typeof parseDependencyGraph> | null = null;
  let build: {
    ok: boolean;
    exitCode: number;
    durationSeconds: number;
    outputTail: string;
    logPath: null;
  } | null = null;
  if (parsed.build)
    build = await dispatchAuthorizedAction(
      "dependency_build",
      {
        projectDir,
        environment: selected.environment,
        purpose: "dependency_audit",
        approvalId: parsed.buildApprovalId,
      },
      context,
      async () => {
        check();
        const started = performance.now();
        const result = await platformioExecutor.execute(
          "run",
          ["--project-dir", projectDir, "--environment", selected.environment],
          {
            cwd: projectDir,
            timeout: 600000,
            env: { ...process.env, PYTHONIOENCODING: "utf-8" },
          },
        );
        check();
        graphEvidence = parseDependencyGraph(
          `${result.stdout}\n${result.stderr}`,
        );
        return {
          ok: result.exitCode === 0,
          exitCode: result.exitCode,
          durationSeconds: (performance.now() - started) / 1000,
          outputTail: redactSecretsInText(`${result.stdout}\n${result.stderr}`)
            .split(/\r?\n/)
            .slice(-30)
            .join("\n")
            .slice(-32768),
          logPath: null,
        };
      },
    );
  const issues = auditDependencies(selected.declared, inventory.libraries);
  check();
  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity]++;
  return {
    ok:
      inventory.complete && counts.error === 0 && (build === null || build.ok),
    environment: selected.environment,
    declared: selected.declared,
    installed: inventory.libraries,
    issues,
    counts,
    inventoryComplete: inventory.complete,
    diagnostics: inventory.diagnostics,
    build,
    ...dependencyGraphFields(graphEvidence),
    summary: `${selected.environment}: ${selected.declared.length} declarations, ${inventory.libraries.length} observed libraries; ${counts.error} errors, ${counts.warning} warnings, ${counts.info} notes.${inventory.complete ? "" : " Inventory evidence is incomplete."}`,
  };
}

/** Preserve parser evidence independently of subprocess success and inventory findings. */
function dependencyGraphFields(
  evidence: ReturnType<typeof parseDependencyGraph> | null,
) {
  return {
    graph: evidence?.graph ?? null,
    graphStatus: evidence?.status ?? "not_collected",
    recursionErrorObserved: evidence?.recursionErrorObserved ?? false,
  };
}
