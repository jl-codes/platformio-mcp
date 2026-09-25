/**
 * MCP Tool Registry
 *
 * Provides:
 * - createToolRegistry: Builds one validated source of truth for tool metadata.
 * - listRegisteredTools: Produces MCP list-tools output with complete annotations.
 * - getRegisteredTool: Resolves the sole handler and policy mapping for a tool.
 */

import { MCP_ACTIONS } from "../core/action-catalog.js";
import type { PolicyRiskLevel } from "../core/policy/types.js";

/** MCP annotations used by Codex to reason about side effects. */
export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/** Minimal tool declaration accepted by the MCP SDK. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Partial<ToolAnnotations>;
}

/** Context supplied by the MCP request adapter to registered handlers. */
export interface ToolExecutionContext<TResult> {
  dispatch: (name: string, args: Record<string, unknown>) => Promise<TResult>;
}

/** Complete internal contract for one listed and callable tool. */
export interface RegisteredTool<TResult = unknown> extends ToolDefinition {
  annotations: ToolAnnotations;
  policyAction: string;
  riskLevel: PolicyRiskLevel;
  handler: (
    args: Record<string, unknown>,
    context: ToolExecutionContext<TResult>,
  ) => Promise<TResult>;
}

function titleForTool(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Builds and validates the complete MCP registry.
 *
 * @param definitions - Public tool declarations.
 * @returns Name-keyed registry with one fixed-name handler per declaration.
 */
export function createToolRegistry<TResult>(
  definitions: readonly ToolDefinition[],
): ReadonlyMap<string, RegisteredTool<TResult>> {
  const registry = new Map<string, RegisteredTool<TResult>>();
  for (const definition of definitions) {
    if (registry.has(definition.name)) {
      throw new Error(`Duplicate MCP tool declaration: ${definition.name}`);
    }
    const safety = MCP_ACTIONS[definition.name];
    if (!safety) {
      throw new Error(`Missing MCP safety metadata: ${definition.name}`);
    }
    registry.set(definition.name, {
      ...definition,
      policyAction: safety.policyAction ?? definition.name,
      riskLevel: safety.riskLevel,
      annotations: {
        title: definition.annotations?.title ?? titleForTool(definition.name),
        readOnlyHint: definition.annotations?.readOnlyHint ?? safety.readOnly,
        destructiveHint:
          definition.annotations?.destructiveHint ?? safety.destructive,
        idempotentHint:
          definition.annotations?.idempotentHint ?? safety.idempotent,
        openWorldHint:
          definition.annotations?.openWorldHint ?? safety.openWorld,
      },
      handler: (args, context) => context.dispatch(definition.name, args),
    });
  }

  const orphanedSafety = Object.keys(MCP_ACTIONS).filter(
    (name) => !registry.has(name),
  );
  if (orphanedSafety.length > 0) {
    throw new Error(
      `Safety metadata exists for unlisted MCP tools: ${orphanedSafety.join(", ")}`,
    );
  }
  return registry;
}

/** Returns one registered tool or throws a stable unknown-tool error. */
export function getRegisteredTool<TResult>(
  registry: ReadonlyMap<string, RegisteredTool<TResult>>,
  name: string,
): RegisteredTool<TResult> {
  const tool = registry.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool;
}

/** Produces MCP list-tools output without internal handler/policy fields. */
export function listRegisteredTools<TResult>(
  registry: ReadonlyMap<string, RegisteredTool<TResult>>,
): ToolDefinition[] {
  return [...registry.values()].map(
    ({ name, description, inputSchema, annotations }) => ({
      name,
      description,
      inputSchema,
      annotations,
    }),
  );
}
