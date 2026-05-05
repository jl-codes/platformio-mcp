/**
 * Portal Event Bus
 * Provides an event emitter singleton to stream data to the web dashboard.
 *
 * Provides:
 * - portalEvents: Global singleton event emitter for portal communication.
 * - PortalEventEmitter: Class defining the portal event bus behavior.
 */
import { EventEmitter } from "events";
import fs from "node:fs";
import path from "node:path";
import { addWorkspace } from "../utils/workspace-registry.js";

class PortalEventEmitter extends EventEmitter {
  constructor() {
    super();
    // Allow higher limits as we could have many tools emitting concurrently during heavy loads
    this.setMaxListeners(50);
  }

  /**
   * Emit an agentic activity event.
   * @param toolName The name of the tool called
   * @param args The arguments passed to the tool
   * @param status The execution status (running, success, error)
   * @param activityId A unique identifier for this activity
   */
  async emitActivity(toolName: string, args: Record<string, any>, status: 'running' | 'success' | 'error', activityId: string) {
    const payload = {
      timestamp: Date.now(),
      toolName,
      args,
      success: status === 'success', // Kept for backwards compatibility
      status,
      activityId,
    };
    this.emit("agent_activity", payload);

    if (this.lastKnownProjectDir) {
      try {
        const workspaceDir = path.join(this.lastKnownProjectDir, ".pio-mcp-workspace");
        if (!fs.existsSync(workspaceDir)) {
          fs.mkdirSync(workspaceDir, { recursive: true });
        }
        const logFile = path.join(workspaceDir, "agent_activities.jsonl");
        try {
          const stat = await fs.promises.stat(logFile);
          if (stat.size > 2 * 1024 * 1024) {
            await fs.promises.rename(logFile, logFile + ".1");
          }
        } catch (e) {}
        await fs.promises.appendFile(logFile, JSON.stringify(payload) + "\n");
      } catch (e) {}
    }
  }

  private artifactBuffers: Record<string, string> = {};

  /**
   * Emit a build log stream, buffering partial chunks into clean lines
   * @param projectId The target project identifier
   * @param taskId The task ID generating the log
   * @param chunk Raw string chunk of the log
   */
  emitTaskLog(projectId: string, taskId: string | undefined, chunk: string) {
    const bufferKey = taskId || projectId;
    if (!this.artifactBuffers[bufferKey]) {
      this.artifactBuffers[bufferKey] = "";
    }
    this.artifactBuffers[bufferKey] += chunk;

    let newlineIndex: number;
    while ((newlineIndex = this.artifactBuffers[bufferKey].indexOf("\n")) !== -1) {
      const logLine = this.artifactBuffers[bufferKey]
        .substring(0, newlineIndex)
        .trimEnd();
      this.artifactBuffers[bufferKey] = this.artifactBuffers[bufferKey].substring(
        newlineIndex + 1,
      );

      this.emit("build_log", {
        timestamp: Date.now(),
        projectId,
        taskId,
        logLine,
      });
    }
  }

  /**
   * Emit a signal to clear the build terminal for a project
   * @param projectId The target project identifier
   * @param taskId Optional specific task ID
   * @param logPaths Optional list of associated log files
   */
  clearTaskLog(projectId: string, taskId?: string, logPaths?: string[]) {
    const bufferKey = taskId || projectId;
    if (this.artifactBuffers[bufferKey]) {
      this.artifactBuffers[bufferKey] = "";
    }
    this.emit("build_clear", {
      timestamp: Date.now(),
      projectId,
      taskId,
      logPaths,
    });
  }

  /**
   * Emit a serial monitor read
   * @param port Serial port emitting the log
   * @param data Log payload data
   * @param taskId Optional task ID
   */
  emitSerialLog(port: string, data: string, taskId?: string) {
    this.emit("serial_log", {
      timestamp: Date.now(),
      port,
      taskId,
      data,
    });
  }

  /**
   * Emit general server status
   * @param status String enum of "online" or "offline"
   */
  emitServerStatus(status: "online" | "offline") {
    this.emit("server_status", {
      timestamp: Date.now(),
      status,
    });
  }

  /**
   * Emit hardware queue lock status
   * @param state The lock state object
   */
  emitLockState(state: {
    isLocked: boolean;
    sessionId?: string;
    reason?: string;
  }) {
    this.emit("lock_state", {
      timestamp: Date.now(),
      ...state,
    });
  }

  /**
   * Emit a map of all spooler connection and config properties
   * @param states Record mapping ports to spooler states
   */
  emitSpoolerStates(states: Record<string, any>) {
    this.emit("spooler_states", states);
  }

  /**
   * Emit an update signal when the command history registry changes
   * @param projectDir Target project context
   */
  emitCommandHistoryUpdated(projectDir: string) {
    this.emit("command_history_updated", {
      timestamp: Date.now(),
      projectDir,
    });
  }

  /**
   * Emit a signal containing the latest rich hardware port state
   * @param devices List of device objects
   */
  emitHardwareStateUpdated(devices: unknown[]) {
    this.emit("hardware_state_updated", {
        timestamp: Date.now(),
        devices
    });
  }

  private lastKnownProjectDir?: string;

  /**
   * Caches and emits the last known dynamically targeted workspace directory.
   * @param projectDir Target project directory path
   */
  emitWorkspaceState(projectDir: string) {
    this.lastKnownProjectDir = projectDir;
    
    // Dynamically persist to the server-level tracking registry
    addWorkspace(projectDir);

    this.emit("workspace_state", {
      timestamp: Date.now(),
      projectDir,
    });
  }

  /**
   * Retrieves the last known workspace path
   * @returns The last targeted workspace directory
   */
  getLastKnownWorkspace() {
    return this.lastKnownProjectDir;
  }

  /**
   * Emit an update signal when the overall workspaces registry changes.
   * @param workspaces List of available workspace directories
   */
  emitWorkspacesUpdated(workspaces: string[]) {
    this.emit("workspaces_updated", {
      timestamp: Date.now(),
      workspaces,
    });
  }
}

/**
 * Singleton instance of the portal event emitter.
 * Used internally by MCP tools to stream live metrics.
 */
export const portalEvents = new PortalEventEmitter();
