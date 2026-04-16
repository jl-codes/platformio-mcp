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

  // REST Auth Middleware restricting access to /api endpoints
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

  app.post("/api/spooler/start", async (req, res) => {
    try {
      if (hardwareLockManager.getLockStatus().isLocked) {
        throw new Error(
          "Hardware queue is currently locked by an active agent operation.",
        );
      }
      const { port, projectDir } = req.body;
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

  io.on("connection", (socket) => {
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
          const content = fs.readFileSync(daemon.logFile, "utf8");
          const lines = content.split("\n").slice(-50);
          socket.emit("serial_log", {
            timestamp: Date.now(),
            port,
            data: lines.join("\n")
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
          const content = fs.readFileSync(activityLogPath, "utf8");
          const lines = content.trim().split("\n").slice(-100);
          for (const line of lines) {
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

        // Hydrate last 50 lines of build log
        try {
          const content = fs.readFileSync(latestBuildLog, "utf8");
          const lines = content.split("\n").slice(-50);
          for (const line of lines) {
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

  // Ensure port 8080 is relinquished cleanly if the parent IDE terminates the MCP server
  const cleanup = () => {
    httpServer.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  return { app, httpServer, io, authToken: PORTAL_AUTH_TOKEN };
}
