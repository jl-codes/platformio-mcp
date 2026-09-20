/** Register opt-in project aliases while preserving canonical permission metadata. */
import type { RegisteredTool } from "../mcp/tool-registry.js";

/** Extend a canonical registry without changing its entries or granting additional permissions. */
export function withProjectCompatibility<TResult>(
  base: ReadonlyMap<string, RegisteredTool<TResult>>,
): ReadonlyMap<string, RegisteredTool<TResult>> {
  const result = new Map(base);
  for (const canonical of [
    "project_envs",
    "project_metadata",
    "list_targets",
  ]) {
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
    if (canonical !== "project_envs")
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
  const init = base.get("init_project");
  if (!init || result.has("pio_project_init"))
    throw new Error("Invalid init compatibility registry");
  result.set("pio_project_init", {
    ...init,
    name: "pio_project_init",
    description:
      "Initialize a PlatformIO project with ordered options. Canonical initialization and configuration-read permissions apply before filesystem changes.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["project_dir", "board"],
      properties: {
        project_dir: { type: "string", minLength: 1, maxLength: 32768 },
        board: { type: "string", minLength: 1, maxLength: 256 },
        framework: { type: ["string", "null"] },
        project_options: {
          type: ["array", "null"],
          maxItems: 128,
          items: { type: "string", maxLength: 4096 },
        },
        approval_id: { type: "string", maxLength: 256 },
        config_approval_id: { type: "string", maxLength: 256 },
      },
    },
    handler: (args, context) => context.dispatch("pio_project_init", args),
  });
  const clean = base.get("clean_project");
  if (!clean || result.has("pio_clean"))
    throw new Error("Invalid clean compatibility registry");
  result.set("pio_clean", {
    ...clean,
    name: "pio_clean",
    description:
      "Clean selected build artifacts, optionally including dependencies. Canonical destructive cleanup permission applies.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_dir: { type: ["string", "null"], maxLength: 32768 },
        env: { type: ["string", "null"], pattern: "^[a-zA-Z0-9_-]{1,50}$" },
        full: { type: "boolean", default: false },
        approval_id: { type: "string", maxLength: 256 },
      },
    },
    handler: (args, context) => context.dispatch("pio_clean", args),
  });
  return result;
}
