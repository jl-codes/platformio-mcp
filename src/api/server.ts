/**
 * HTTP and WebSocket API Server
 * Hosts the web dashboard and streams continuous MCP states natively.
 *
 * Provides:
 * - startPortalServer: Initializes Express and Socket.io endpoints and hooks into the event bus
 * - getDashboardStatus: Conditionally bootstraps server and returns secure URL payload
 * - activePortalStatus: Global registry for UI runtime variables
 *
 * REST API Routes:
 * - /api/devices & /hardware: Query connected serial devices
 * - /api/workspaces & /projects: Manage active project contexts
 * - /api/commands/*: Trigger PIO toolchain actions (build, upload, clean, check)
 * - /api/libraries/*: Search, install, and uninstall library dependencies
 * - /api/spooler/*: Manage background serial telemetry listeners
 * - /api/logs: Retrieve full background task log streams
 */
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import crypto from "node:crypto";
import { portalEvents } from "./events.js";
import {
  getSpoolerStates,
  startMonitor,
  stopMonitor,
} from "../tools/monitor.js";
import { listDevices } from "../tools/devices.js";
import { exec } from "child_process";
import open from "open";
import fs from "node:fs";
import { hardwareLockManager } from "../utils/lock-manager.js";
import { isBuildActive } from "../utils/process-manager.js";
import { tailFileBounded } from "../utils/tail.js";
import { getCommandHistory, registerCommand, updateCommandStatus } from "../utils/command-registry.js";
import { mcpContext } from "../utils/mcp-context.js";
import { getWorkspaces } from "../utils/workspace-registry.js";
import { getProjectConfig, isValidProject } from "../tools/projects.js";
import { searchLibraries, listInstalledLibraries, installLibrary, uninstallLibrary } from "../tools/libraries.js";
import { buildProject, cleanProject, checkProject, runTests } from "../tools/build.js";
import { uploadFirmware, uploadFilesystem } from "../tools/upload.js";
import { GLOBAL_LOCKS_DIR } from "../utils/paths.js";
import { addWorkspace } from "../utils/workspace-registry.js";
import { killAllTrackedProcesses, sweepGhostTasks } from "../utils/process-manager.js";
import { execSync } from "node:child_process";
import {
  approveRequest,
  denyRequest,
  getApproval,
  listApprovalRequests,
} from "../core/policy/approvals.js";
import { readRecentAuditEvents } from "../core/policy/audit-log.js";
import { diagnoseBuildLog } from "../core/diagnostics/build-diagnostics.js";
import { diagnoseUploadLog } from "../core/diagnostics/upload-diagnostics.js";
import { diagnoseSerialLog } from "../core/diagnostics/serial-diagnostics.js";
import type { DiagnosticResult } from "../core/diagnostics/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Secure randomized access token for local API authentication
const PORTAL_AUTH_TOKEN = crypto.randomUUID();

/**
 * Global singleton tracking the health, bound port, and session payload
 * of the actively running Web Dashboard instance.
 */
export const activePortalStatus = {
  running: false,
  port: 0,
  token: PORTAL_AUTH_TOKEN,
  // Tracks whether we have already spawned an OS browser tab for this process
  // lifetime. Prevents the "million windows" failure mode where repeated
  // invocations of getDashboardStatus(true) (rehydration, tool calls, multiple
  // Cline profiles, etc.) each fire a fresh open(secureLink).
  browserOpened: false
};

function parseDeviceLocks() {
  const locks: Array<{
    lockFile: string;
    port: string;
    claimType?: string;
    ownerWorkspace?: string;
    ownerPid?: number;
    timestamp?: number;
  }> = [];

  if (!fs.existsSync(GLOBAL_LOCKS_DIR)) {
    return locks;
  }

  for (const file of fs.readdirSync(GLOBAL_LOCKS_DIR)) {
    if (!file.endsWith(".json")) continue;
    const lockFile = path.join(GLOBAL_LOCKS_DIR, file);
    try {
      const payload = JSON.parse(fs.readFileSync(lockFile, "utf8"));
      const claim = payload?.current_claim ?? payload;
      locks.push({
        lockFile,
        port: file.replace(/\.json$/i, ""),
        claimType: claim?.type,
        ownerWorkspace: claim?.owner_workspace,
        ownerPid: claim?.owner_pid,
        timestamp: claim?.timestamp,
      });
    } catch {
      locks.push({
        lockFile,
        port: file.replace(/\.json$/i, ""),
      });
    }
  }

  return locks;
}

function diagnoseByTaskType(
  type: string | undefined,
  logText: string,
  rawLogPath?: string,
  success?: boolean,
): DiagnosticResult {
  if (type === "upload") {
    return diagnoseUploadLog(logText, { rawLogPath, success });
  }
  if (type === "monitor") {
    return diagnoseSerialLog(logText, { rawLogPath, success });
  }
  return diagnoseBuildLog(logText, { rawLogPath, success });
}

/**
 * Retrieves the operational footprint of the user-facing Web Dashboard.
 * Intelligently boots the local Express daemon on demand if it is dormant,
 * and intercepts hard-blocks configured via environment flags.
 * 
 * @param autoOpen If true, seamlessly dispatches a subshell command to route the host's default web browser to the secure link.
 * @param projectDir Optional project directory to register upon startup.
 * @returns A dictionary dictating the physical port, localhost domain string, and active session cryptographic token.
 */
export async function getDashboardStatus(autoOpen: boolean = false, projectDir?: string) {
  if (process.argv.includes("--disable-dashboard") || process.env.PIO_MCP_DISABLE_DASHBOARD === "true") {
    throw new Error("Dashboard is administratively disabled by the host environment.");
  }

  if (projectDir) {
    addWorkspace(projectDir);
  }

  if (!activePortalStatus.running) {
    // On-Demand boot
    startPortalServer();
    await new Promise<void>((resolve, reject) => {
      let attempts = 0;
      const check = setInterval(() => {
        if (activePortalStatus.running) {
          clearInterval(check);
          resolve();
        } else if (attempts++ > 60) {
          clearInterval(check);
          reject(new Error("Timeout waiting for Web Dashboard to boot"));
        }
      }, 500);
    });
  }

  const url = `http://localhost:${activePortalStatus.port}`;
  let secureLink = `${url}?token=${activePortalStatus.token}`;
  if (projectDir) {
    secureLink += `&projectDir=${encodeURIComponent(projectDir)}`;
  }
  
  if (autoOpen) {
    // Guarded — see browserOpened + PIO_MCP_NO_BROWSER below
    if (process.env.PIO_MCP_NO_BROWSER === "true" || process.argv.includes("--no-browser")) {
      // user opted out of auto-opening — leave secureLink in the return payload only
    } else if (!activePortalStatus.browserOpened) {
      activePortalStatus.browserOpened = true;
      open(secureLink).catch(() => { /* swallow — dashboard URL is logged anyway */ });
    }
  }

  return { url, token: activePortalStatus.token, secureLink, status: "online" };
}

/**
 * Initializes and binds the Portal REST/WS endpoints.
 * @param defaultPort Optional static port configuration.
 * @returns The established application instances { app, httpServer, io }
 */
export function startPortalServer(defaultPort = 8080) {
  const app = express();
  const httpServer = createServer(app);

  // Configure strict CORS for local UI dev mode
  const allowedOrigins = [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
  const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (like curl) or explicitly matched localhost origins
      if (!origin || allowedOrigins.some(regex => regex.test(origin))) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  };

  app.use(cors(corsOptions));
  app.use(express.json());

  // Unauthenticated health ping for deployment orchestrators
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "alive" });
  });

  // REST Auth Middleware restricting access to /api endpoints
  const apiLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 100,
    message: { error: "Too many requests from this IP, please try again after 5 minutes" }
  });

  app.use("/api", apiLimiter);

  app.use("/api", (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${PORTAL_AUTH_TOKEN}`) {
      res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
      return;
    }
    next();
  });

  /**
   * Retrieves a list of all connected serial devices (e.g., development boards).
   * 
   * Route: GET /api/devices
   * 
   * @returns JSON array of connected hardware devices
   */
  app.get("/api/devices", async (_req, res) => {
    try {
      const devices = await listDevices();
      res.json(devices);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Alias for /api/devices. Retrieves a list of connected serial devices.
   * 
   * Route: GET /api/hardware
   * 
   * @returns JSON array of connected hardware devices
   */
  app.get("/api/hardware", async (_req, res) => {
    try {
      const hardware = await listDevices();
      res.json(hardware);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Retrieves the historical and active command registry for the workspace.
   * Clears out any ghost tasks before returning the history.
   * 
   * Route: GET /api/commands
   * 
   * @param {string} [req.query.projectDir] - Optional project directory to scope the command history
   * @returns JSON array representing the chronological command history
   */
  app.get("/api/commands", async (req, res) => {
    try {
      const projectDir = req.query.projectDir as string | undefined;
      await sweepGhostTasks(projectDir);
      const history = getCommandHistory(projectDir);
      res.json(history);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Retrieves the current safety and diagnostics overview for dashboard rendering.
   *
   * Route: GET /api/safety/overview
   *
   * @param {string} [req.query.projectDir] - Optional project directory to scope audit and command history.
   * @returns Aggregated safety/policy and diagnostics payload.
   */
  app.get("/api/safety/overview", async (req, res) => {
    try {
      const projectDir = req.query.projectDir as string | undefined;
      const pendingApprovals = listApprovalRequests({
        status: "pending",
        limit: 25,
      });
      const recentAuditEvents = readRecentAuditEvents({
        workspaceDir: projectDir,
        limit: 100,
      });
      const deviceLocks = parseDeviceLocks();
      const commandHistory = getCommandHistory(projectDir);
      const recentCommands = commandHistory.slice(-40).reverse();

      const recentDiagnostics: Array<{
        commandId?: string;
        taskId?: string;
        toolName?: string;
        status?: string;
        diagnostic: DiagnosticResult;
      }> = [];
      const rawLogLinks: Array<{
        commandId?: string;
        taskId?: string;
        type?: string;
        logPath: string;
        exists: boolean;
      }> = [];

      const extractResponseDiagnostic = (response: any): DiagnosticResult | undefined => {
        if (!response) return undefined;
        if (response.diagnostic) return response.diagnostic as DiagnosticResult;
        if (Array.isArray(response?.content) && response.content[0]?.text) {
          try {
            const parsed = JSON.parse(response.content[0].text);
            if (parsed?.diagnostic) return parsed.diagnostic as DiagnosticResult;
          } catch {
            // Ignore parse failures.
          }
        }
        return undefined;
      };

      for (const cmd of recentCommands) {
        const commandLevelDiagnostic = extractResponseDiagnostic(cmd.mcpResponse);
        if (commandLevelDiagnostic) {
          recentDiagnostics.push({
            commandId: cmd.id,
            toolName: cmd.mcpToolName,
            status: cmd.status,
            diagnostic: commandLevelDiagnostic,
          });
        }

        const tasks = cmd.tasks || [];
        for (const task of tasks) {
          const firstLogPath = task.logPaths?.[0];
          if (firstLogPath) {
            rawLogLinks.push({
              commandId: cmd.id,
              taskId: task.taskId,
              type: task.type,
              logPath: firstLogPath,
              exists: fs.existsSync(firstLogPath),
            });
          }

          if (!firstLogPath || !fs.existsSync(firstLogPath)) {
            continue;
          }

          try {
            const lines = await tailFileBounded(firstLogPath, 128 * 1024);
            const logText = lines.join("\n");
            const success =
              task.status === "success" ||
              task.status === "terminated" ||
              (task.exitCode !== undefined && task.exitCode === 0);

            const diagnostic = diagnoseByTaskType(
              task.type,
              logText,
              firstLogPath,
              success,
            );
            recentDiagnostics.push({
              commandId: cmd.id,
              taskId: task.taskId,
              toolName: cmd.mcpToolName,
              status: task.status,
              diagnostic,
            });
          } catch {
            // Best-effort diagnostics only.
          }
        }
      }

      // Keep payload bounded for dashboard responsiveness.
      const dedupedDiagnostics = recentDiagnostics
        .filter((item, idx, arr) => {
          const key = `${item.commandId ?? "none"}::${item.taskId ?? "none"}::${item.diagnostic.timestamp}`;
          return arr.findIndex((x) => `${x.commandId ?? "none"}::${x.taskId ?? "none"}::${x.diagnostic.timestamp}` === key) === idx;
        })
        .slice(0, 50);

      res.json({
        pendingApprovals,
        recentAuditEvents: recentAuditEvents.slice(0, 100),
        deviceLocks,
        recentDiagnostics: dedupedDiagnostics,
        rawLogLinks: rawLogLinks.slice(0, 100),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Lists approval requests with optional status filtering.
   *
   * Route: GET /api/safety/approvals
   *
   * @param {string} [req.query.status] - Optional approval status filter.
   * @param {number} [req.query.limit] - Optional max records to return.
   * @returns Approval request list.
   */
  app.get("/api/safety/approvals", async (req, res) => {
    try {
      const status = req.query.status as
        | "pending"
        | "approved"
        | "denied"
        | "expired"
        | undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const approvals = listApprovalRequests({ status, limit });
      res.json(approvals);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Approves an approval request.
   *
   * Route: POST /api/safety/approvals/:id/approve
   */
  app.post("/api/safety/approvals/:id/approve", async (req, res) => {
    try {
      const { id } = req.params;
      const existing = getApproval(id);
      if (!existing) {
        res.status(404).json({ error: `Approval not found: ${id}` });
        return;
      }
      const approved = approveRequest(id);
      res.json({ success: true, approval: approved });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Denies an approval request.
   *
   * Route: POST /api/safety/approvals/:id/deny
   */
  app.post("/api/safety/approvals/:id/deny", async (req, res) => {
    try {
      const { id } = req.params;
      const existing = getApproval(id);
      if (!existing) {
        res.status(404).json({ error: `Approval not found: ${id}` });
        return;
      }
      const denied = denyRequest(id);
      res.json({ success: true, approval: denied });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Retrieves a list of all recognized PlatformIO workspace projects from the registry.
   * 
   * Route: GET /api/workspaces
   * 
   * @returns JSON array of registered workspaces
   */
  app.get("/api/workspaces", async (_req, res) => {
    try {
      const workspaces = await getWorkspaces();
      res.json(workspaces);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Wrapper function for executing an MCP tool command triggered via the Web Dashboard.
   * Handles registering the command in the telemetry ledger, executing it safely 
   * within the MCP context, tracking the response, and standardizing error handling.
   * 
   * @param toolName - The identifier of the MCP tool being executed
   * @param projectDir - The target PlatformIO workspace directory
   * @param requestPayload - The raw JSON body of the API request
   * @param action - The specific async execution logic for the command
   * @param res - The Express response object used to reply to the client
   */
  async function executeDashboardCommand(
    toolName: string,
    projectDir: string,
    requestPayload: any,
    action: () => Promise<any>,
    res: any
  ) {
  if (!projectDir) {
    res.status(400).json({ error: "Missing projectDir parameter" });
    return;
  }
  
  const activityId = crypto.randomUUID();
  try {
    await registerCommand({
      id: activityId,
      commandDesc: `Dashboard Action`,
      timestamp: Date.now(),
      status: "running",
      tasks: [],
      mcpRequest: requestPayload,
      mcpToolName: toolName,
      source: "dashboard"
    }, projectDir);

    const result = await mcpContext.run({ activityId, targetProjectDir: projectDir }, action);

    let storedResponse = result;
    try {
      const responseString = JSON.stringify(result);
      if (responseString.length > 1000) {
        storedResponse = { truncated: true, message: "Response truncated to save ledger space" };
      }
    } catch {}

    await updateCommandStatus(activityId, {
      status: (result?.status === "running" && result?.message === "Task dispatched to background.") ? "running" : "success",
      mcpResponse: storedResponse
    }, projectDir);

    res.json(result);
  } catch (e: any) {
    await updateCommandStatus(activityId, {
      status: "error",
      mcpResponse: { error: e.message }
    }, projectDir);
    res.status(500).json({ error: e.message });
  }
}

  /**
   * Compiles the project source code and generates firmware binary.
   * 
   * Route: POST /api/commands/build
   * 
   * @param {string} req.body.projectDir - Path to the PlatformIO project directory
   * @param {string} [req.body.environment] - Optional specific environment to build
   * @param {boolean} [req.body.verbose] - If true, returns the complete verbose build log
   * @returns JSON object containing the command execution result and task status
   */
  app.post("/api/commands/build", async (req, res) => {
    executeDashboardCommand("build_project", req.body.projectDir, req.body, async () => {
      const { projectDir, environment, verbose } = req.body;
      return await buildProject(projectDir, environment, verbose, true);
    }, res);
  });

  /**
   * Forcefully cleans all server locks and terminates tracked compilation PIDs.
   * 
   * Route: POST /api/server/reset
   * 
   * @param {string} [req.body.projectDir] - Optional project directory to scope the reset
   * @returns JSON object confirming the reset operation
   */
  app.post("/api/server/reset", async (req, res) => {
    executeDashboardCommand("reset_server_state", req.body.projectDir, req.body, async () => {
      const projectDir = req.body.projectDir as string | undefined;
      await killAllTrackedProcesses(projectDir);

      // Release MCP Explicit Lock
      const status = hardwareLockManager.getLockStatus();
      if (status.isLocked && status.sessionId) {
        hardwareLockManager.releaseLock(status.sessionId);
      }

      // Release OS-level Semaphores
      try {
        if (fs.existsSync(GLOBAL_LOCKS_DIR)) {
          for (const file of fs.readdirSync(GLOBAL_LOCKS_DIR)) {
            if (file.endsWith(".json") || file.endsWith(".lock")) {
              fs.unlinkSync(path.join(GLOBAL_LOCKS_DIR, file));
            }
          }
        }
      } catch (e) {}
      
      return { success: true, message: "System state has been reset and all locks cleared." };
    }, res);
  });

  /**
   * Opens a native OS dialog to select and register a new PlatformIO workspace.
   * 
   * Route: POST /api/workspaces/browse
   * 
   * @returns JSON object with the registered path, or an error if invalid
   */
  app.post("/api/workspaces/browse", async (_req, res) => {
    try {
      let result = execSync("osascript -e 'POSIX path of (choose folder)'").toString().trim();
      if (result) {
        // macOS choose folder always returns a trailing slash. We normalize it.
        result = path.resolve(result);

        if (!(await isValidProject(result))) {
          // TODO(Option B): UI Board Selector flow
          // In the future, instead of returning a strict error here, return a payload like { needs_init: true, path: result }
          // This would trigger a React modal where the user can search and select from 1000+ PlatformIO boards 
          // to run `pio project init` before automatically adding it to the registry.
          res.status(400).json({ error: "This folder is not a PlatformIO project. Please initialize it using the AI Agent or terminal first, then try opening it again." });
          return;
        }
        await addWorkspace(result);
        const workspaces = await getWorkspaces();
        portalEvents.emitWorkspacesUpdated(workspaces);
        res.json({ path: result });
      } else {
        res.status(400).json({ error: "No folder selected" });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Removes build artifacts and compiled files from the project.
   * 
   * Route: POST /api/commands/clean
   * 
   * @param {string} req.body.projectDir - Path to the PlatformIO project directory
   * @returns JSON object containing the command execution result
   */
  app.post("/api/commands/clean", async (req, res) => {
    executeDashboardCommand("clean_project", req.body.projectDir, req.body, async () => {
      const { projectDir } = req.body;
      return await cleanProject(projectDir, true);
    }, res);
  });

  /**
   * Uploads compiled firmware to a connected device. Automatically builds if necessary.
   * 
   * Route: POST /api/commands/upload_firmware
   * 
   * @param {string} req.body.projectDir - Path to the PlatformIO project directory
   * @param {string} [req.body.environment] - Optional specific environment from platformio.ini
   * @param {string} [req.body.port] - Optional upload port (auto-detected if not specified)
   * @param {boolean} [req.body.start_monitor] - If true, starts serial monitor after upload
   * @param {boolean} [req.body.verbose] - If true, returns verbose upload log
   * @returns JSON object containing the command execution result
   */
  app.post("/api/commands/upload_firmware", async (req, res) => {
    executeDashboardCommand("upload_firmware", req.body.projectDir, req.body, async () => {
      const { projectDir, environment, port, start_monitor, verbose } = req.body;
      return await uploadFirmware(projectDir, port, environment, verbose, true, start_monitor);
    }, res);
  });

  /**
   * Builds and uploads a SPIFFS/LittleFS filesystem image to the connected device.
   * 
   * Route: POST /api/commands/upload_filesystem
   * 
   * @param {string} req.body.projectDir - Path to the PlatformIO project directory
   * @param {string} [req.body.environment] - Optional specific environment from platformio.ini
   * @param {string} [req.body.port] - Optional upload port
   * @returns JSON object containing the command execution result
   */
  app.post("/api/commands/upload_filesystem", async (req, res) => {
    executeDashboardCommand("upload_filesystem", req.body.projectDir, req.body, async () => {
      const { projectDir, environment, port } = req.body;
      return await uploadFilesystem(projectDir, port, environment, false, true, false);
    }, res);
  });

  /**
   * Validates unit tests locally or on hardware.
   * 
   * Route: POST /api/commands/run_tests
   * 
   * @param {string} req.body.projectDir - Path to the PlatformIO project directory
   * @param {string} [req.body.environment] - Optional specific environment to test
   * @returns JSON object containing the command execution result
   */
  app.post("/api/commands/run_tests", async (req, res) => {
    executeDashboardCommand("run_tests", req.body.projectDir, req.body, async () => {
      const { projectDir, environment } = req.body;
      return await runTests(projectDir, environment, true);
    }, res);
  });

  /**
   * Runs static analysis validation on the project source code.
   * 
   * Route: POST /api/commands/check_project
   * 
   * @param {string} req.body.projectDir - Path to the PlatformIO project directory
   * @param {string} [req.body.environment] - Optional specific environment to check
   * @returns JSON object containing the command execution result
   */
  app.post("/api/commands/check_project", async (req, res) => {
    executeDashboardCommand("check_project", req.body.projectDir, req.body, async () => {
      const { projectDir, environment } = req.body;
      return await checkProject(projectDir, environment, true);
    }, res);
  });

  /**
   * Retrieves and serves a complete log file from a specific background task.
   * 
   * Route: GET /api/logs
   * 
   * @param {string} req.query.taskId - The UUID of the task to retrieve logs for
   * @param {string} [req.query.projectDir] - The project directory associated with the task
   * @returns Raw text stream of the log file contents
   */
  app.get("/api/logs", async (req, res) => {
    try {
      const { taskId, projectDir } = req.query;
      if (!taskId) {
        res.status(400).json({ error: "Missing taskId parameter" });
        return;
      }
      
      const history = getCommandHistory(projectDir as string | undefined);
      const task = history.flatMap(c => c.tasks || []).find(t => t.taskId === taskId);
      
      if (!task) {
        res.status(404).json({ error: "Task not found in registry" });
        return;
      }
      if (!task.logPaths || task.logPaths.length === 0) {
        res.status(404).json({ error: "No log paths mapped for this task" });
        return;
      }
      
      if (!fs.existsSync(task.logPaths[0])) {
        res.status(404).json({ error: "Log file missing from disk" });
        return;
      }
      
      // Serve file completely
      const fileStream = fs.createReadStream(task.logPaths[0]);
      res.setHeader('Content-Type', 'text/plain');
      fileStream.pipe(res);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Retrieves system diagnostic path output and PIO environment information.
   * 
   * Route: GET /api/system/info
   * 
   * @returns JSON object with system diagnostics
   */
  app.get("/api/system/info", async (_req, res) => {
    try {
      const { getSystemInfo } = await import("../tools/projects.js");
      const info = await getSystemInfo();
      res.json(info);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Dumps the parsed platformio.ini JSON configuration for a workspace.
   * 
   * Route: GET /api/projects/config
   * 
   * @param {string} req.query.projectDir - Path to the PlatformIO project directory
   * @returns JSON object of the parsed platformio.ini configuration
   */
  app.get("/api/projects/config", async (req, res) => {
    try {
      const { projectDir } = req.query;
      if (!projectDir) {
        res.status(400).json({ error: "Missing projectDir parameter" });
        return;
      }
      const config = await getProjectConfig(projectDir as string);
      res.json(config);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Searches the PlatformIO library registry for available libraries.
   * 
   * Route: GET /api/libraries/search
   * 
   * @param {string} req.query.query - Search query string
   * @returns JSON array of search results
   */
  app.get("/api/libraries/search", async (req, res) => {
    try {
      const { query } = req.query;
      if (!query) {
        res.json([]);
        return;
      }
      const libs = await searchLibraries(query as string, 25);
      res.json(libs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Lists all installed libraries either globally or for a specific project.
   * 
   * Route: GET /api/libraries/installed
   * 
   * @param {string} [req.query.projectDir] - Path to the PlatformIO project directory
   * @returns JSON array of installed libraries
   */
  app.get("/api/libraries/installed", async (req, res) => {
    try {
      const { projectDir } = req.query;
      const libs = await listInstalledLibraries(projectDir as string | undefined);
      res.json(libs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Installs a library from the PlatformIO registry to a specific project.
   * Acquires the hardware queue lock during operation.
   * 
   * Route: POST /api/libraries/install
   * 
   * @param {string} req.body.library - Library name or ID to install
   * @param {string} req.body.projectDir - Path to the PlatformIO project directory
   * @returns JSON object containing the command execution result
   */
  app.post("/api/libraries/install", async (req, res) => {
    executeDashboardCommand("install_library", req.body.projectDir, req.body, async () => {
      const { library, projectDir } = req.body;
      
      const lockStatus = hardwareLockManager.getLockStatus();
      if (lockStatus.isLocked) {
        if (!isBuildActive(projectDir)) {
          hardwareLockManager.releaseLock(lockStatus.sessionId!);
        } else {
          throw new Error("Hardware queue is currently locked by an active agent operation. Please wait for the build to finish.");
        }
      }

      const reqSessionId = crypto.randomUUID();
      hardwareLockManager.acquireLock(reqSessionId, "Installing Library: " + library);
      portalEvents.emitLockState(hardwareLockManager.getLockStatus());

      try {
        return await installLibrary(library, { projectDir });
      } finally {
        hardwareLockManager.releaseLock(reqSessionId);
        portalEvents.emitLockState(hardwareLockManager.getLockStatus());
      }
    }, res);
  });

  /**
   * Removes a library from a specific project.
   * Acquires the hardware queue lock during operation.
   * 
   * Route: POST /api/libraries/uninstall
   * 
   * @param {string} req.body.library - Library name or ID to uninstall
   * @param {string} req.body.projectDir - Path to the PlatformIO project directory
   * @returns JSON object containing the command execution result
   */
  app.post("/api/libraries/uninstall", async (req, res) => {
    executeDashboardCommand("uninstall_library", req.body.projectDir, req.body, async () => {
      const { library, projectDir } = req.body;

      const lockStatus = hardwareLockManager.getLockStatus();
      if (lockStatus.isLocked) {
        if (!isBuildActive(projectDir)) {
          hardwareLockManager.releaseLock(lockStatus.sessionId!);
        } else {
          throw new Error("Hardware queue is currently locked by an active agent operation. Please wait for the build to finish.");
        }
      }

      const reqSessionId = crypto.randomUUID();
      hardwareLockManager.acquireLock(reqSessionId, "Uninstalling Library: " + library);
      portalEvents.emitLockState(hardwareLockManager.getLockStatus());

      try {
        return await uninstallLibrary(library, projectDir);
      } finally {
        hardwareLockManager.releaseLock(reqSessionId);
        portalEvents.emitLockState(hardwareLockManager.getLockStatus());
      }
    }, res);
  });



  /**
   * Manually starts or restarts the background serial-to-disk spooler for a specific device.
   * 
   * Route: POST /api/spooler/start
   * 
   * @param {string} [req.body.port] - Optional COM path
   * @param {string} req.body.projectDir - Path to the PlatformIO project directory
   * @returns JSON object containing the command execution result
   */
  app.post("/api/spooler/start", async (req, res) => {
    executeDashboardCommand("start_monitor", req.body.projectDir, req.body, async () => {
      const { port, projectDir } = req.body;
      const lockStatus = hardwareLockManager.getLockStatus();
      
      if (lockStatus.isLocked) {
        if (!isBuildActive(projectDir)) {
          // Orphaned explicit lock detected (agent forgot to release or crashed).
          // Auto-evict the stale lock so the UI isn't permanently bricked.
          hardwareLockManager.releaseLock(lockStatus.sessionId!);
        } else {
          throw new Error(
            "Hardware queue is currently locked by an active agent operation.",
          );
        }
      }
      return await startMonitor(
        port,
        115200,
        projectDir,
      );
    }, res);
  });

  /**
   * Kills the active background serial listener and unlocks the UART.
   * 
   * Route: POST /api/spooler/stop
   * 
   * @param {string} [req.body.port] - Optional COM port to stop listening on. If omitted, stops all.
   * @returns JSON object containing the command execution result
   */
  app.post("/api/spooler/stop", async (req, res) => {
    executeDashboardCommand("stop_monitor", req.body.projectDir, req.body, async () => {
      const { port } = req.body;
      if (port) {
        await stopMonitor(port);
      } else {
        // Fallback: stop all if no port specified (though UI should always specify)
        const states = getSpoolerStates();
        for (const p of Object.keys(states)) {
          await stopMonitor(p);
        }
      }
      return { success: true };
    }, res);
  });

  /**
   * Launches the native PIO Home server in the background.
   * 
   * Route: POST /api/commands/pio_home
   * 
   * @param {string} [req.body.projectDir] - Optional project directory
   * @returns JSON object confirming launch
   */
  app.post("/api/commands/pio_home", async (req, res) => {
    executeDashboardCommand("start_pio_home", req.body.projectDir, req.body, async () => {
      // Execute the PIO Home server in the background
      exec("pio home --port 8008");
      return { success: true, message: "PIO Home launched" };
    }, res);
  });

  const io = new Server(httpServer, {
    cors: {
      origin: corsOptions.origin as any,
      methods: ["GET", "POST"],
    },
  });

  // Socket.io Auth Middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (token === PORTAL_AUTH_TOKEN) {
      next();
    } else {
      next(new Error("Unauthorized"));
    }
  });

  // Serve static UI if built
  const webDistPath = path.join(__dirname, "..", "..", "web", "dist");
  app.use(express.static(webDistPath));

  io.on("connection", async (socket) => {
    socket.emit("connection_established", {
      message: "Connected to PIO MCP Backend",
    });

    // Provide initial status state
    socket.emit("server_status", { timestamp: Date.now(), status: "online" });
    const spoolers = getSpoolerStates();
    socket.emit("spooler_states", spoolers);
    
    // Hydrate last 50 lines of active serial logs
    for (const [port, daemon] of Object.entries(spoolers)) {
      if (daemon.logFile && fs.existsSync(daemon.logFile)) {
        try {
          socket.emit("serial_clear", { port });

          const lines = await tailFileBounded(daemon.logFile);
          const tailLines = lines.slice(-50);
          socket.emit("serial_log", {
            timestamp: Date.now(),
            port,
            data: tailLines.join("\n")
          });
        } catch (e) {}
      }
    }

    socket.emit("lock_state", {
      timestamp: Date.now(),
      ...hardwareLockManager.getLockStatus(),
    });

    // Inject active workspace layer naturally on UI boot
    const activeWorkspace = portalEvents.getLastKnownWorkspace();
    if (activeWorkspace) {
      socket.emit("workspace_state", {
        timestamp: Date.now(),
        projectDir: activeWorkspace,
      });

      // Hydrate last 100 agent activity logs
      const activityLogPath = path.join(activeWorkspace, ".pio-mcp-workspace", "agent_activities.jsonl");
      if (fs.existsSync(activityLogPath)) {
        try {
          const lines = await tailFileBounded(activityLogPath);
          const tailLines = lines.slice(-100);
          for (const line of tailLines) {
            if (line.trim()) {
              socket.emit("agent_activity", JSON.parse(line));
            }
          }
        } catch (e) {}
      }

      // Provide initial build log state natively mapped to PR 4 structure
      const latestBuildLog = path.join(activeWorkspace, ".pio-mcp-workspace", "logs", "build", "latest-build.log");
      if (fs.existsSync(latestBuildLog)) {
        socket.emit("build_state", {
          timestamp: Date.now(),
          logFile: latestBuildLog,
        });

        // Clear existing local state on frontend to prevent duplicates across reconnects
        socket.emit("build_clear", { logFile: latestBuildLog });

        // Hydrate last 50 lines of build log
        try {
          const lines = await tailFileBounded(latestBuildLog);
          const tailLines = lines.slice(-50);
          for (const line of tailLines) {
            if (line.trim()) {
              socket.emit("build_log", {
                timestamp: Date.now(),
                projectId: activeWorkspace,
                logLine: line,
              });
            }
          }
        } catch (e) {}
      }
    }
  });

  // Wire up event bus to websocket broadcasts
  portalEvents.on("agent_activity", (data) => io.emit("agent_activity", data));
  portalEvents.on("build_log", (data) => io.emit("build_log", data));
  portalEvents.on("build_clear", (data) => io.emit("build_clear", data));
  portalEvents.on("serial_log", (data) => io.emit("serial_log", data));
  portalEvents.on("server_status", (data) => io.emit("server_status", data));
  portalEvents.on("spooler_states", (data) => io.emit("spooler_states", data));
  portalEvents.on("command_history_updated", (data) => io.emit("command_history_updated", data));
  portalEvents.on("hardware_state_updated", (data) => io.emit("hardware_state_updated", data));
  portalEvents.on("workspace_state", (data) =>
    io.emit("workspace_state", data),
  );
  portalEvents.on("lock_state", (data) => io.emit("lock_state", data));

  let port = process.env.PORTAL_PORT
    ? parseInt(process.env.PORTAL_PORT)
    : defaultPort;

  let retries = 0;
  const maxRetries = 10;

  const startListening = () => {
    httpServer.listen(port, () => {
      activePortalStatus.running = true;
      activePortalStatus.port = (httpServer.address() as any)?.port || port;

      console.error(`\n======================================================`);
      console.error(
        `🚀 MCP Server Web Portal running at: http://localhost:${activePortalStatus.port}`,
      );
      console.error(
        `🔑 Authentication Token: ${PORTAL_AUTH_TOKEN}`,
      );
      console.error(`======================================================\n`);

      // Intentionally not auto-opening the browser anymore as per opt-in logic,
      // but if the flag is provided, the user can open it manually.
    });
  };

  // Catch EADDRINUSE to prevent fatal crash and implement retry logic
  httpServer.on("error", (e: any) => {
    if (e.code === "EADDRINUSE") {
      if (retries < maxRetries) {
        retries++;
        console.error(
          `[INFO] Port ${port} is busy, retrying next port in 2s... (Attempt ${retries}/${maxRetries})`,
        );
        port++;
        setTimeout(() => {
          startListening();
        }, 2000);
      } else {
        console.error(
          `\n[WARN] Port ${port} is still in use after ${maxRetries} retries. The Web Dashboard will be disabled.`,
        );
        console.error(
          `[WARN] To fix this, kill the process on port ${port} or use PORTAL_PORT environment variable.\n`,
        );
      }
    } else {
      throw e;
    }
  });

  startListening();

  // Background loop to poll hardware state
  setInterval(async () => {
    try {
      const devices = await listDevices();
      portalEvents.emitHardwareStateUpdated(devices);
    } catch (e) {}
  }, 5000);

  // Ensure port 8080 is relinquished cleanly if the parent IDE terminates the MCP server
  const cleanup = () => {
    httpServer.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  return { app, httpServer, io, authToken: PORTAL_AUTH_TOKEN };
}
