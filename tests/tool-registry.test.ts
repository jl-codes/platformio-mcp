import { describe, expect, it } from "vitest";
import {
  createToolRegistry,
  getRegisteredTool,
  listRegisteredTools,
  type ToolDefinition,
} from "../src/mcp/tool-registry.js";

const TOOL_NAMES = [
  "list_boards",
  "get_board_info",
  "list_devices",
  "init_project",
  "build_project",
  "clean_project",
  "upload_filesystem",
  "upload_firmware",
  "acquire_lock",
  "release_lock",
  "get_lock_status",
  "search_libraries",
  "install_library",
  "list_installed_libraries",
  "start_monitor",
  "stop_monitor",
  "query_logs",
  "reset_server_state",
  "check_task_status",
  "get_dashboard_url",
  "get_project_context",
  "get_project_config",
  "agent_validate_project",
  "agent_build_diagnose",
  "agent_safe_pin_audit",
  "agent_flash_monitor_verify",
  "agent_get_last_report",
  "agent_generate_board_report",
  "get_policy_status",
  "agent_resolve_target",
  "get_monitor_status",
  "capture_serial_window",
  "agent_monitor_health",
  "cancel_task",
  "list_task_history",
  "get_approval_request",
  "list_pending_approvals",
  "system_info",
  "check_project",
  "run_tests",
  "uninstall_library",
  "update_library",
] as const;

function definitions(): ToolDefinition[] {
  return TOOL_NAMES.map((name) => ({
    name,
    description: `${name} description`,
    inputSchema: { type: "object", properties: {} },
  }));
}

describe("MCP tool registry", () => {
  it("assigns one complete contract and fixed-name handler to every tool", async () => {
    const registry = createToolRegistry<string>(definitions());
    const listed = listRegisteredTools(registry);
    expect(listed).toHaveLength(42);
    expect(
      listed.every(
        (tool) =>
          tool.annotations &&
          typeof tool.annotations.readOnlyHint === "boolean" &&
          typeof tool.annotations.destructiveHint === "boolean" &&
          typeof tool.annotations.idempotentHint === "boolean" &&
          typeof tool.annotations.openWorldHint === "boolean",
      ),
    ).toBe(true);

    const upload = getRegisteredTool(registry, "upload_firmware");
    expect(upload.riskLevel).toBe("high");
    expect(upload.annotations.destructiveHint).toBe(true);
    await expect(
      upload.handler(
        {},
        {
          dispatch: async (name) => name,
        },
      ),
    ).resolves.toBe("upload_firmware");
  });

  it("fails closed for duplicate, unknown, or incomplete declarations", () => {
    const complete = definitions();
    expect(() => createToolRegistry([...complete, complete[0]])).toThrow(
      /duplicate/i,
    );
    expect(() => createToolRegistry(complete.slice(1))).toThrow(
      /unlisted MCP tools/i,
    );
    expect(() =>
      createToolRegistry([
        ...complete.slice(0, -1),
        { name: "unknown_tool", description: "unknown", inputSchema: {} },
      ]),
    ).toThrow(/missing MCP safety metadata/i);
  });
});
