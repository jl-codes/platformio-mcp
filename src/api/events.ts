/**
 * Portal Event Bus
 * Provides an event emitter singleton to stream data to the web dashboard.
 *
 * Provides:
 * - portalEvents: Global singleton event emitter for portal communication.
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
   */
  emitArtifactLog(projectId: string, artifactId: string | undefined, chunk: string) {
    const bufferKey = artifactId || projectId;
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
        artifactId,
        logLine,
      });
    }
  }

  /**
   * Emit a signal to clear the build terminal for a project
   */
  clearArtifactLog(projectId: string, artifactId?: string, logFile?: string) {
    const bufferKey = artifactId || projectId;
    if (this.artifactBuffers[bufferKey]) {
      this.artifactBuffers[bufferKey] = "";
    }
    this.emit("build_clear", {
      timestamp: Date.now(),
      projectId,
      artifactId,
      logFile,
    });
  }

  /**
   * Emit a serial monitor read
   */
  emitSerialLog(port: string, data: string, artifactId?: string) {
    this.emit("serial_log", {
      timestamp: Date.now(),
      port,
      artifactId,
      data,
    });
  }

  /**
   * Emit general server status
   */
  emitServerStatus(status: "online" | "offline") {
    this.emit("server_status", {
      timestamp: Date.now(),
      status,
    });
  }

  /**
   * Emit hardware queue lock status
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
   */
  emitSpoolerStates(states: Record<string, any>) {
    this.emit("spooler_states", states);
  }

  /**
   * Emit an update signal when the command history registry changes
   */
  emitCommandHistoryUpdated(projectDir: string) {
    this.emit("command_history_updated", {
      timestamp: Date.now(),
      projectDir,
    });
  }

  /**
   * Emit a signal containing the latest rich hardware port state
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

  getLastKnownWorkspace() {
    return this.lastKnownProjectDir;
  }
}

/**
 * Singleton instance of the portal event emitter.
 * Used internally by MCP tools to stream live metrics.
 */
export const portalEvents = new PortalEventEmitter();
