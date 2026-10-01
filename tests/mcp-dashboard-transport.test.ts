/** Verifies typed panel actions use existing MCP tools and preserve denials. */

import { expect, it, vi } from "vitest";
import { McpDashboardTransport, type DashboardHostBridge } from "../web/src/lib/mcp-dashboard-transport.js";

it("reads project-scoped status and bounded task output through MCP", async () => {
  const callServerTool = vi.fn(async ({ name }: { name: string; arguments: Record<string, unknown> }) => ({
    structuredContent: {
      success: true,
      data: name === "list_devices" ? [{ port: "COM3" }]
        : name === "get_project_context" ? { environments: ["test"] }
        : name === "list_task_history" ? { tasks: [{ commandId: "c1", taskId: "t1", type: "build", status: "running", startedAt: "2026-09-30T00:00:00Z" }], observedAt: "2026-09-30T00:00:01Z" }
        : { taskId: "t1", targetStatus: "running", output: "bounded output" },
    },
  }));
  const bridge = { callServerTool, openLink: vi.fn(async () => ({})) } satisfies DashboardHostBridge;
  const transport = new McpDashboardTransport(bridge);

  const snapshot = await transport.readSnapshot("C:/firmware");
  expect(snapshot.tasks).toHaveLength(1);
  expect(callServerTool).toHaveBeenCalledWith({ name: "get_policy_status", arguments: { projectDir: "C:/firmware" } });
  expect(callServerTool).toHaveBeenCalledWith({ name: "get_lock_status", arguments: {} });
  expect(callServerTool).toHaveBeenCalledWith({ name: "list_pending_approvals", arguments: { projectDir: "C:/firmware", limit: 20 } });
  expect(callServerTool).toHaveBeenCalledWith({ name: "get_monitor_status", arguments: { projectDir: "C:/firmware" } });
  expect(callServerTool).toHaveBeenCalledWith({ name: "list_task_history", arguments: { projectDir: "C:/firmware", limit: 20 } });
  expect(await transport.readTask("C:/firmware", snapshot.tasks[0])).toEqual({ taskId: "t1", status: "running", output: "bounded output" });
  expect(callServerTool).toHaveBeenCalledWith({ name: "check_task_status", arguments: { projectDir: "C:/firmware", taskId: "c1" } });
});

it("keeps server policy denials and opens only a host-approved browser link", async () => {
  const callServerTool = vi.fn(async ({ name }: { name: string; arguments: Record<string, unknown> }) => name === "build_project"
    ? { isError: true, structuredContent: { success: false, summary: "Build denied by policy" } }
    : { structuredContent: { success: true, data: { status: "online", launchUrl: "http://127.0.0.1:8080/auth/launch?ticket=redacted" } } });
  const openLink = vi.fn(async () => ({}));
  const transport = new McpDashboardTransport({ callServerTool, openLink });

  await expect(transport.build("C:/firmware")).rejects.toThrow("Build denied by policy");
  expect(openLink).not.toHaveBeenCalled();
  await transport.openBrowserDashboard("C:/firmware");
  expect(callServerTool).toHaveBeenCalledWith({ name: "get_dashboard_url", arguments: { projectDir: "C:/firmware", open: false } });
  expect(openLink).toHaveBeenCalledOnce();
});
