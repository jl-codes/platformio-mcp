/**
 * HTTP and WebSocket API Server
 * Hosts the web dashboard and streams continuous MCP states natively.
 *
 * Provides:
 * - startPortalServer: Initializes Express and Socket.io endpoints and hooks into the event bus
 * - getDashboardStatus: Conditionally bootstraps server and returns secure URL payload
 * - activePortalStatus: Global registry for UI runtime variables
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
import fs from "node:fs";
import { hardwareLockManager } from "../utils/lock-manager.js";
import { isBuildActive } from "../utils/process-manager.js";
import { tailFileBounded } from "../utils/tail.js";
import { getCommandHistory } from "../utils/command-registry.js";
import { getProjectConfig } from "../tools/projects.js";
import { searchLibraries, listInstalledLibraries, installLibrary, uninstallLibrary } from "../tools/libraries.js";
import { buildProject, cleanProject } from "../tools/build.js";
import { uploadFirmware, uploadFilesystem } from "../tools/upload.js";

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
  token: PORTAL_AUTH_TOKEN
};

/**
 * Retrieves the operational footprint of the user-facing Web Dashboard.
 * Intelligently boots the local Express daemon on demand if it is dormant,
 * and intercepts hard-blocks configured via environment flags.
 * 
 * @param autoOpen If true, seamlessly dispatches a subshell command to route the host's default web browser to the secure link.
 * @returns A dictionary dictating the physical port, localhost domain string, and active session cryptographic token.
 */
export async function getDashboardStatus(autoOpen: boolean = false) {
  if (process.argv.includes("--disable-dashboard") || process.env.PIO_MCP_DISABLE_DASHBOARD === "true") {
    throw new Error("Dashboard is administratively disabled by the host environment.");
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
        } else if (attempts++ > 10) {
          clearInterval(check);
          reject(new Error("Timeout waiting for Web Dashboard to boot"));
        }
      }, 500);
    });
  }

  const url = `http://localhost:${activePortalStatus.port}`;
  const secureLink = `${url}?token=${activePortalStatus.token}`;
  
  if (autoOpen) {
    exec(`open "${secureLink}"`, () => {});
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

  app.get("/api/devices", async (_req, res) => {
    try {
      const devices = await listDevices();
      res.json(devices);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/hardware", async (_req, res) => {
    try {
      const hardware = await listDevices();
      res.json(hardware);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/commands", (req, res) => {
    try {
      const projectDir = req.query.projectDir as string | undefined;
      const history = getCommandHistory(projectDir);
      res.json(history);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/logs", async (req, res) => {
    try {
      const { commandId, artifactId, projectDir } = req.query;
      if (!commandId || !artifactId) {
        res.status(400).json({ error: "Missing commandId or artifactId parameter" });
        return;
      }
      
      const history = getCommandHistory(projectDir as string | undefined);
      const command = history.find(c => c.id === commandId);
      
      if (!command) {
        res.status(404).json({ error: "Command not found in registry" });
        return;
      }

      const artifact = command.artifacts?.find(a => a.id === artifactId);
      if (!artifact) {
        res.status(404).json({ error: "Artifact not found in command" });
        return;
      }
      if (!artifact.logFile) {
        res.status(404).json({ error: "No logFile mapped for this artifact" });
        return;
      }
      
      if (!fs.existsSync(artifact.logFile)) {
        res.status(404).json({ error: "Log file missing from disk" });
        return;
      }
      
      // Serve file completely
      const fileStream = fs.createReadStream(artifact.logFile);
      res.setHeader('Content-Type', 'text/plain');
      fileStream.pipe(res);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

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

  app.get("/api/libraries/installed", async (req, res) => {
    try {
      const { projectDir } = req.query;
      const libs = await listInstalledLibraries(projectDir as string | undefined);
      res.json(libs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/libraries/install", async (req, res) => {
    let lockerSession;
    try {
      const { library, projectDir } = req.body;
      
      const lockStatus = hardwareLockManager.getLockStatus();
      if (lockStatus.isLocked) {
        if (!isBuildActive(projectDir)) {
          hardwareLockManager.releaseLock(lockStatus.sessionId!);
        } else {
          throw new Error("Hardware queue is currently locked by an active agent operation. Please wait for the build to finish.");
        }
      }

      lockerSession = hardwareLockManager.acquireLock("Installing Library: " + library);
      if (!lockerSession.success) {
        throw new Error("Failed to acquire hardware lock");
      }
      portalEvents.emitLockState({ timestamp: Date.now(), ...hardwareLockManager.getLockStatus() });

      const result = await installLibrary(library, { projectDir });
      
      hardwareLockManager.releaseLock(lockerSession.sessionId);
      portalEvents.emitLockState({ timestamp: Date.now(), ...hardwareLockManager.getLockStatus() });

      res.json(result);
    } catch (e: any) {
      if (lockerSession && lockerSession.success) {
        hardwareLockManager.releaseLock(lockerSession.sessionId);
        portalEvents.emitLockState({ timestamp: Date.now(), ...hardwareLockManager.getLockStatus() });
      }
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/libraries/uninstall", async (req, res) => {
    let lockerSession;
    try {
      const { library, projectDir } = req.body;

      const lockStatus = hardwareLockManager.getLockStatus();
      if (lockStatus.isLocked) {
        if (!isBuildActive(projectDir)) {
          hardwareLockManager.releaseLock(lockStatus.sessionId!);
        } else {
          throw new Error("Hardware queue is currently locked by an active agent operation. Please wait for the build to finish.");
        }
      }

      lockerSession = hardwareLockManager.acquireLock("Uninstalling Library: " + library);
      if (!lockerSession.success) {
        throw new Error("Failed to acquire hardware lock");
      }
      portalEvents.emitLockState({ timestamp: Date.now(), ...hardwareLockManager.getLockStatus() });

      const result = await uninstallLibrary(library, projectDir);
      
      hardwareLockManager.releaseLock(lockerSession.sessionId);
      portalEvents.emitLockState({ timestamp: Date.now(), ...hardwareLockManager.getLockStatus() });

      res.json(result);
    } catch (e: any) {
      if (lockerSession && lockerSession.success) {
        hardwareLockManager.releaseLock(lockerSession.sessionId);
        portalEvents.emitLockState({ timestamp: Date.now(), ...hardwareLockManager.getLockStatus() });
      }
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/commands/build", async (req, res) => {
    try {
      const { projectDir, environment } = req.body;
      const result = await buildProject(projectDir, environment, false, true);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/commands/clean", async (req, res) => {
    try {
      const { projectDir } = req.body;
      const result = await cleanProject(projectDir, true);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/commands/upload", async (req, res) => {
    try {
      const { projectDir, port, environment } = req.body;
      const result = await uploadFirmware(projectDir, port, environment, false, true, true);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/commands/uploadfs", async (req, res) => {
    try {
      const { projectDir, port, environment } = req.body;
      const result = await uploadFilesystem(projectDir, port, environment, false, true, true);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/spooler/start", async (req, res) => {
    try {
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
      const result = await startMonitor(
        port,
        115200,
        projectDir,
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/spooler/stop", async (req, res) => {
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
    res.json({ success: true });
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
      const latestBuildLog = path.join(activeWorkspace, ".pio-mcp-workspace", "build_logs", "latest-build.log");
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
