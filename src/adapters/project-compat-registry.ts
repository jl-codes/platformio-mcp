/** Register opt-in project aliases while preserving canonical permission metadata. */
import type { RegisteredTool } from "../mcp/tool-registry.js";

/** Extend a canonical registry without changing its entries or granting additional permissions. */
export function withProjectCompatibility<TResult>(
  base: ReadonlyMap<string, RegisteredTool<TResult>>,
): ReadonlyMap<string, RegisteredTool<TResult>> {
  const result = new Map(base);
  for (const canonical of ["project_envs", "project_metadata"]) {
    const name = `pio_${canonical}`;
    const source = base.get(canonical);
    if (!source || result.has(name))
      throw new Error(`Invalid compatibility mapping: ${name}`);
    const properties: Record<string, unknown> = {
      project_dir: {
        anyOf: [{ type: "string" }, { type: "null" }],
        default: null,
      },
      approval_id: {
        type: "string",
        description: "Optional scoped canonical approval identifier.",
      },
    };
    if (canonical === "project_metadata")
      properties.env = {
        anyOf: [{ type: "string" }, { type: "null" }],
        default: null,
      };
    result.set(name, {
      ...source,
      name,
      description: `Compatibility alias for ${canonical}. Uses the same server permissions and project implementation.`,
      inputSchema: {
        type: "object",
        properties,
        required: [],
        additionalProperties: false,
      },
      handler: (args, context) => context.dispatch(name, args),
    });
  }
  return result;
}
