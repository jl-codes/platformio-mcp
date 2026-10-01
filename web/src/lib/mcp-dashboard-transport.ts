/**
 * Typed dashboard operations over the MCP Apps host bridge.
 *
 * Provides:
 * - McpDashboardTransport: Maps project, device, task, log, and build actions to existing MCP tools.
 */

/** Compact task record returned by the existing project-scoped history tool. */
export interface DashboardTask {
  commandId: string;
  taskId: string;
  type: string;
  status: string;
  startedAt: string;
  error?: string;
}

/** Data displayed after one bounded status refresh. */
export interface DashboardSnapshot {
  devices: unknown;
  project: unknown;
  tasks: DashboardTask[];
  policy: unknown;
  lock: unknown;
  approvals: unknown;
  monitor: unknown;
  observedAt: string;
}

/** Bounded task output already redacted by the MCP server. */
export interface DashboardTaskOutput {
  taskId: string;
  status: string;
  output: string;
}

/** Minimal MCP Apps methods needed by the panel. */
export interface DashboardHostBridge {
  callServerTool(params: { name: string; arguments: Record<string, unknown> }): Promise<{
    isError?: boolean;
    structuredContent?: unknown;
    content?: Array<{ type: string; text?: string }>;
  }>;
  openLink(params: { url: string }): Promise<{ isError?: boolean }>;
}

/** Converts mixed legacy and structured results into one checked payload. */
function resultData(result: Awaited<ReturnType<DashboardHostBridge["callServerTool"]>>): unknown {
  let value = result.structuredContent;
  if (value === undefined) {
    const text = result.content?.find((item) => item.type === "text")?.text;
    if (text) {
      try { value = JSON.parse(text); } catch { value = text; }
    }
  }
  if (result.isError) throw new Error(typeof value === "object" && value && "summary" in value ? String(value.summary) : String(value));
  if (typeof value === "object" && value && "success" in value && value.success === false) {
    throw new Error("summary" in value ? String(value.summary) : "PIO Agent denied the request.");
  }
  return typeof value === "object" && value && "data" in value ? value.data : value;
}

/** Safely narrows an unknown result to a record. */
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Maps existing policy-governed tools to panel actions without an HTTP proxy. */
export class McpDashboardTransport {
  constructor(private readonly bridge: DashboardHostBridge) {}

  /** Reads core project state and best-effort operational status. */
  async readSnapshot(projectDir: string): Promise<DashboardSnapshot> {
    const [devices, project, history] = await Promise.all([
      this.call("list_devices", {}),
      this.call("get_project_context", { projectDir }),
      this.call("list_task_history", { projectDir, limit: 20 }),
    ]);
    const status = await Promise.allSettled([
      this.call("get_policy_status", { projectDir }),
      this.call("get_lock_status", {}),
      this.call("list_pending_approvals", { projectDir, limit: 20 }),
      this.call("get_monitor_status", { projectDir }),
    ]);
    const optional = (index: number): unknown => status[index].status === "fulfilled"
      ? status[index].value
      : { unavailable: true, reason: String((status[index] as PromiseRejectedResult).reason) };
    const historyRecord = record(history);
    return {
      devices,
      project,
      tasks: Array.isArray(historyRecord.tasks) ? historyRecord.tasks as DashboardTask[] : [],
      policy: optional(0),
      lock: optional(1),
      approvals: optional(2),
      monitor: optional(3),
      observedAt: typeof historyRecord.observedAt === "string" ? historyRecord.observedAt : new Date().toISOString(),
    };
  }

  /** Reads server-bounded, redacted output for one selected task. */
  async readTask(projectDir: string, task: DashboardTask): Promise<DashboardTaskOutput> {
    const payload = record(await this.call("check_task_status", { projectDir, taskId: task.commandId }));
    return {
      taskId: task.taskId,
      status: typeof payload.targetStatus === "string" ? payload.targetStatus : "unknown",
      output: typeof payload.output === "string" ? payload.output : "No output available.",
    };
  }

  /** Starts a build through the existing workspace and policy checks. */
  async build(projectDir: string, environment?: string): Promise<unknown> {
    return this.call("build_project", {
      projectDir,
      ...(environment ? { environment } : {}),
      background: true,
    });
  }

  /** Opens the authenticated browser dashboard; this is not operator enrollment. */
  async openBrowserDashboard(projectDir: string): Promise<void> {
    const payload = record(await this.call("get_dashboard_url", { projectDir, open: false }));
    if (payload.status !== "online" || typeof payload.launchUrl !== "string") {
      throw new Error("The browser dashboard is unavailable.");
    }
    const opened = await this.bridge.openLink({ url: payload.launchUrl });
    if (opened.isError) throw new Error("The host did not open the browser dashboard.");
  }

  /** Calls one named MCP tool and rejects policy failures. */
  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    return resultData(await this.bridge.callServerTool({ name, arguments: args }));
  }
}
