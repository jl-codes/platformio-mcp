/** Opt-in dependency vocabulary mapped to the canonical authorized audit service. */
import { z } from "zod";
import { inspectDependencies } from "../tools/dependency-inspection.js";
import {
  resolveCompatibilityProject,
  type CompatibilityProjectDefaults,
} from "./compatibility-project.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import type { RegisteredTool } from "../mcp/tool-registry.js";
import { PlatformIOError } from "../utils/errors.js";
const text = z
  .string()
  .max(4096)
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value));
const schema = z
  .object({
    project_dir: text.nullable().optional(),
    env: text.nullable().optional(),
    build: z.boolean().default(false),
    approval_id: text.optional(),
    configuration_approval_id: text.optional(),
    inventory_approval_id: text.optional(),
    build_approval_id: text.optional(),
  })
  .strict();
/** Translate validated arguments, preserving each distinct approval scope. */
export async function executeDependencyCompatibility(
  name: string,
  input: unknown,
  defaults: CompatibilityProjectDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  if (name !== "pio_deps_check")
    throw new PlatformIOError(
      "Unknown dependency compatibility tool.",
      "COMPAT_TOOL_UNKNOWN",
    );
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new PlatformIOError(
      "Invalid dependency compatibility arguments.",
      "COMPAT_ARGUMENT_INVALID",
    );
  const args = parsed.data;
  const result = await inspectDependencies(
    {
      projectDir: await resolveCompatibilityProject(args.project_dir, defaults),
      environment: args.env || undefined,
      build: args.build,
      approvalId: args.approval_id,
      configurationApprovalId: args.configuration_approval_id,
      inventoryApprovalId: args.inventory_approval_id,
      buildApprovalId: args.build_approval_id,
    },
    caller,
    onAuthorized,
  );
  return dependencyCompatibilityResult(result);
}
/** Compact result projection keeps incomplete evidence and observed graph status explicit. */
export function dependencyCompatibilityResult(
  result: Awaited<ReturnType<typeof inspectDependencies>>,
) {
  return {
    ok: result.ok,
    summary: result.summary,
    env: result.environment,
    declared: result.declared,
    installed: result.installed.map((lib) => ({
      ...lib,
      dir_name: lib.directoryName,
    })),
    issues: result.issues,
    issue_count: result.issues.length,
    counts: result.counts,
    graph: result.graph,
    graph_status: result.graphStatus,
    inventory_complete: result.inventoryComplete,
    inventory_timing: result.inventoryTiming,
    diagnostics: result.diagnostics,
    recursion_error_observed: result.recursionErrorObserved,
    build: result.build
      ? {
          ok: result.build.ok,
          duration_s: result.build.durationSeconds,
          log_path: result.build.logPath,
          output_tail: result.build.outputTail,
        }
      : null,
    log_path: null,
  };
}
/** Advertise the alias only on explicit compatibility opt-in, copying canonical safety metadata. */
export function withDependencyCompatibility<TResult>(
  base: ReadonlyMap<string, RegisteredTool<TResult>>,
): ReadonlyMap<string, RegisteredTool<TResult>> {
  const source = base.get("deps_check");
  if (!source || base.has("pio_deps_check"))
    throw new Error("Invalid dependency compatibility registry.");
  const result = new Map(base);
  const properties: Record<string, unknown> = {
    project_dir: {
      anyOf: [{ type: "string" }, { type: "null" }],
      default: null,
    },
    env: { anyOf: [{ type: "string" }, { type: "null" }], default: null },
    build: { type: "boolean", default: false },
  };
  for (const field of [
    "approval_id",
    "configuration_approval_id",
    "inventory_approval_id",
    "build_approval_id",
  ])
    properties[field] = { type: "string", maxLength: 256 };
  result.set("pio_deps_check", {
    ...source,
    name: "pio_deps_check",
    description:
      "Compatibility dependency audit using canonical permissions and optional authorized build evidence.",
    inputSchema: {
      type: "object",
      properties,
      required: [],
      additionalProperties: false,
    },
    handler: (args, context) => context.dispatch("pio_deps_check", args),
  });
  return result;
}
