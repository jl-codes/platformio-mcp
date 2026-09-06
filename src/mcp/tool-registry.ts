/**
 * MCP Tool Registry
 *
 * Provides:
 * - createToolRegistry: Builds one validated source of truth for tool metadata.
 * - listRegisteredTools: Produces MCP list-tools output with complete annotations.
 * - getRegisteredTool: Resolves the sole handler and policy mapping for a tool.
 */

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

interface ToolSafetyMetadata {
  policyAction?: string;
  riskLevel: PolicyRiskLevel;
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
  openWorld: boolean;
}

const READ: ToolSafetyMetadata = {
  riskLevel: "low",
  readOnly: true,
  destructive: false,
  idempotent: true,
  openWorld: false,
};

const TOOL_SAFETY: Record<string, ToolSafetyMetadata> = {
  list_boards: READ,
  get_board_info: READ,
  list_devices: READ,
  init_project: {
    riskLevel: "medium",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
  },
  build_project: {
    riskLevel: "low",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
  },
  clean_project: {
    riskLevel: "medium",
    readOnly: false,
    destructive: true,
    idempotent: true,
    openWorld: false,
  },
  upload_filesystem: {
    riskLevel: "high",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
  },
  upload_firmware: {
    riskLevel: "high",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
  },
  acquire_lock: {
    riskLevel: "low",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: false,
  },
  release_lock: {
    riskLevel: "low",
    readOnly: false,
    destructive: false,
    idempotent: true,
    openWorld: false,
  },
  get_lock_status: READ,
  search_libraries: { ...READ, openWorld: true },
  install_library: {
    riskLevel: "medium",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
  },
  list_installed_libraries: READ,
  start_monitor: {
    riskLevel: "medium",
    readOnly: false,
    destructive: false,
    idempotent: true,
    openWorld: false,
  },
  stop_monitor: {
    riskLevel: "medium",
    readOnly: false,
    destructive: false,
    idempotent: true,
    openWorld: false,
  },
  query_logs: READ,
  reset_server_state: {
    riskLevel: "high",
    readOnly: false,
    destructive: true,
    idempotent: true,
    openWorld: false,
  },
  check_task_status: { ...READ, policyAction: "query_logs" },
  get_dashboard_url: { ...READ, policyAction: "query_logs" },
  get_project_context: READ,
  get_project_config: READ,
  agent_validate_project: READ,
  agent_build_diagnose: {
    riskLevel: "low",
    policyAction: "build_project",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
  },
  agent_safe_pin_audit: READ,
  agent_flash_monitor_verify: {
    riskLevel: "high",
    policyAction: "upload_firmware",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
  },
  agent_get_last_report: READ,
  agent_generate_board_report: READ,
  get_policy_status: READ,
  agent_resolve_target: READ,
  get_monitor_status: READ,
  capture_serial_window: {
    riskLevel: "medium",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: false,
  },
  agent_monitor_health: {
    riskLevel: "medium",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: false,
  },
  cancel_task: {
    riskLevel: "medium",
    readOnly: false,
    destructive: true,
    idempotent: true,
    openWorld: false,
  },
  list_task_history: READ,
  get_approval_request: READ,
  list_pending_approvals: READ,
  system_info: READ,
  check_project: {
    riskLevel: "low",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
  },
  run_tests: {
    riskLevel: "high",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: false,
  },
  uninstall_library: {
    riskLevel: "medium",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: true,
  },
  update_library: {
    riskLevel: "medium",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: true,
  },
};

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
    const safety = TOOL_SAFETY[definition.name];
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

  const orphanedSafety = Object.keys(TOOL_SAFETY).filter(
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
