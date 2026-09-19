/** Add the six pinned package aliases without changing canonical registry entries or safety metadata. */
import type { RegisteredTool } from "../mcp/tool-registry.js";

/** Extend a validated canonical registry; aliases are only constructed after explicit compatibility opt-in. */
export function withPackageCompatibility<TResult>(
  base: ReadonlyMap<string, RegisteredTool<TResult>>,
): ReadonlyMap<string, RegisteredTool<TResult>> {
  const result = new Map(base);
  for (const suffix of [
    "search",
    "install",
    "uninstall",
    "list",
    "outdated",
    "update",
  ]) {
    const canonical = `pkg_${suffix}`;
    const name = `pio_${canonical}`;
    const source = base.get(canonical);
    if (!source || result.has(name))
      throw new Error(`Invalid compatibility mapping: ${name}`);
    const properties: Record<string, unknown> = {
      approval_id: {
        type: "string",
        description: "Optional scoped canonical approval identifier.",
      },
    };
    const required: string[] = [];
    if (suffix === "search") {
      properties.query = { type: "string" };
      properties.page = {
        type: "integer",
        default: 1,
        minimum: 1,
        maximum: 100000,
      };
      required.push("query");
    } else {
      properties.project_dir = {
        anyOf: [{ type: "string" }, { type: "null" }],
        default: null,
      };
      properties.env = {
        anyOf: [{ type: "string" }, { type: "null" }],
        default: null,
      };
    }
    if (["search", "install", "uninstall"].includes(suffix))
      properties.type = {
        type: "string",
        enum: ["library", "platform", "tool"],
        default: "library",
      };
    if (["install", "uninstall"].includes(suffix)) {
      properties.spec = { type: "string" };
      required.push("spec");
    }
    result.set(name, {
      ...source,
      name,
      description: `Compatibility alias for ${canonical}. Uses the same server permissions and package implementation.`,
      inputSchema: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
      handler: (args, context) => context.dispatch(name, args),
    });
  }
  return result;
}
