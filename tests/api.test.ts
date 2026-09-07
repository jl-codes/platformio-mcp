import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { io as Client } from "socket.io-client";
import { startPortalServer } from "../src/api/server.js";
import { portalEvents } from "../src/api/events.js";
import { Server as HttpServer } from "http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock platformio hardware runner to avoid hanging threads
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: {
    spawn: vi.fn(() => ({
      pid: 12345,
      on: vi.fn((event, callback) => {
        if (event === "close") {
          setTimeout(() => callback(0), 10);
        }
      }),
      unref: vi.fn(),
    })),
    executeWithJsonOutput: vi.fn(() => Promise.resolve([])),
  },
  checkPlatformIOInstalled: vi.fn(() => Promise.resolve(true)),
}));

describe("Portal API Security & Telemetry Tailing", () => {
  let app: any;
  let server: HttpServer;
  let authToken: string;
  let port: number;

  beforeAll(async () => {
    // Ephemeral port assignment
    process.env.PORTAL_PORT = "0";

    const portal = startPortalServer();
    app = portal.app;
    server = portal.httpServer;
    authToken = portal.authToken;

    await new Promise<void>((resolve) => {
      server.on("listening", () => {
        port = (server.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe("Security Lock-Down", () => {
    it("should reject REST API requests without a valid token", async () => {
      const response = await request(server).get("/api/devices");
      expect(response.status).toBe(401);
      expect(response.body.error).toContain("Unauthorized");
    });

    it("should reject REST API requests with an invalid token", async () => {
      const response = await request(server)
        .get("/api/devices")
        .set("Authorization", "Bearer invalid-token-123");
      expect(response.status).toBe(401);
    });

    it("should accept REST API requests with a valid token", async () => {
      const response = await request(server)
        .get("/api/devices")
        .set("Authorization", `Bearer ${authToken}`);

      // We don't care if devices fails (500) due to mock/hardware, only that it is NOT a 401
      expect(response.status).not.toBe(401);
    });

    it("exchanges a launch ticket once for an HttpOnly strict session", async () => {
      const { getDashboardStatus } = await import("../src/api/server.js");
      const payload = await getDashboardStatus(false);
      const launchUrl = new URL(payload.launchUrl);
      const launchPath = `${launchUrl.pathname}${launchUrl.search}`;
      const exchange = await request(server).get(launchPath);

      expect(exchange.status).toBe(303);
      expect(exchange.headers.location).toBe("/");
      const cookie = exchange.headers["set-cookie"]?.[0];
      expect(cookie).toContain("pio_mcp_session=");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");

      const sessionResponse = await request(server)
        .get("/api/devices")
        .set("Cookie", cookie);
      expect(sessionResponse.status).not.toBe(401);

      const replay = await request(server).get(launchPath);
      expect(replay.status).toBe(401);
    });

    it("sets strict security headers on the unauthenticated health response", async () => {
      const response = await request(server).get("/healthz");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "alive" });
      expect(response.headers["content-security-policy"]).toContain(
        "default-src 'self'",
      );
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("should reject WebSocket connections without an auth payload", () => {
      return new Promise<void>((resolve) => {
        const clientSocket = Client(`http://localhost:${port}`);
        clientSocket.on("connect_error", (err) => {
          expect(err.message).toBe("Unauthorized");
          clientSocket.close();
          resolve();
        });
      });
    });

    it("should establish secure WebSocket connection with valid token", () => {
      return new Promise<void>((resolve) => {
        const clientSocket = Client(`http://localhost:${port}`, {
          auth: { token: authToken },
        });
        clientSocket.on("connection_established", (data) => {
          expect(data.message).toContain("Connected to PIO Agent backend");
          clientSocket.close();
          resolve();
        });
      });
    });
  });

  describe("Telemetry Tailing Workflow", () => {
    it("should natively tail file changes from disk and dispatch via socket", async () => {
      const { startMonitor, stopMonitor } =
        await import("../src/tools/monitor.js");
      const mockDir = fs.mkdtempSync(path.join(os.tmpdir(), "pio-mcp-test-"));

      // Explicitly spawn monitor using the generic port string
      const monRes = await startMonitor(
        "/dev/cu.usbserial-mock123",
        115200,
        mockDir,
      );
      expect(monRes.success).toBe(true);
      expect(monRes.logFile).toBeDefined();

      const { logFile } = monRes;

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(new Error("Timeout waiting for fs.watch to tail payload")),
          5000,
        );

        // Listen locally to Portal Events Bus
        portalEvents.once("serial_log", (data) => {
          try {
            expect(data.port).toBe("/dev/cu.usbserial-mock123");
            expect(data.data).toBe("hardware_mock_string\n");
            clearTimeout(timeout);
            stopMonitor("/dev/cu.usbserial-mock123").finally(() => resolve());
          } catch (e) {
            reject(e);
          }
        });

        // Trigger tailer via a physical disk write simulation
        setTimeout(() => {
          fs.appendFileSync(logFile!, "hardware_mock_string\n");
        }, 300); // 300ms cushion allows the listener to bind cleanly
      });
    });
  });

  describe("Dashboard Administrative Flags", () => {
    it("should forcefully block getDashboardStatus if the disable flag is present", async () => {
      const { getDashboardStatus } = await import("../src/api/server.js");
      process.env.PIO_MCP_DISABLE_DASHBOARD = "true";

      await expect(getDashboardStatus(false)).rejects.toThrow(
        "administratively disabled",
      );

      // Cleanup flag for rest of lifecycle if needed
      delete process.env.PIO_MCP_DISABLE_DASHBOARD;
    });

    it("should successfully return the stable payload when invoked normally", async () => {
      const { getDashboardStatus } = await import("../src/api/server.js");
      const payload = await getDashboardStatus(false);

      expect(payload.status).toBe("online");
      expect(payload.token).toBe("[REDACTED_DEPRECATED]");
      expect(payload.baseUrl).toBe(`http://127.0.0.1:${port}`);
      expect(payload.launchUrl).toContain("/auth/launch?ticket=");
      expect(payload.launchUrl).not.toContain(authToken);
      expect(payload.expiresAt).toBeDefined();
    });
  });

  describe("Safety Approval APIs", () => {
    it("lists approvals and supports approve/deny actions", async () => {
      const { createApprovalRequest } =
        await import("../src/core/policy/approvals.js");

      const approvalA = createApprovalRequest({
        action: "upload_firmware",
        riskLevel: "high",
        reason: "Test approval A",
        requestedBy: "agent",
      });
      const approvalB = createApprovalRequest({
        action: "upload_firmware",
        riskLevel: "high",
        reason: "Test approval B",
        requestedBy: "agent",
      });

      const listRes = await request(server)
        .get("/api/safety/approvals")
        .set("Authorization", `Bearer ${authToken}`);

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body)).toBe(true);
      expect(listRes.body.some((item: any) => item.id === approvalA.id)).toBe(
        true,
      );
      expect(listRes.body.some((item: any) => item.id === approvalB.id)).toBe(
        true,
      );

      const approveRes = await request(server)
        .post(
          `/api/safety/approvals/${encodeURIComponent(approvalA.id)}/approve`,
        )
        .set("Authorization", `Bearer ${authToken}`);
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.success).toBe(true);
      expect(approveRes.body.approval.status).toBe("approved");

      const denyRes = await request(server)
        .post(`/api/safety/approvals/${encodeURIComponent(approvalB.id)}/deny`)
        .set("Authorization", `Bearer ${authToken}`);
      expect(denyRes.status).toBe(200);
      expect(denyRes.body.success).toBe(true);
      expect(denyRes.body.approval.status).toBe("denied");
    });

    it("reports plugin control state and preserves write budgets during cursor resets", async () => {
      const projectDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "pio-dashboard-safety-"),
      );
      try {
        fs.writeFileSync(
          path.join(projectDir, "platformio.ini"),
          "[env:native]\nplatform = native\n",
          "utf8",
        );
        const { readAutomationState, writeAutomationState } =
          await import("../src/core/automation-state.js");
        const initial = readAutomationState(projectDir, "nightly-health");
        writeAutomationState(projectDir, {
          ...initial,
          cursor: "cursor-1",
          lastStatus: "failed",
          consecutiveFailures: 2,
          consecutiveHardwareWrites: 1,
          lastHardwareWriteAction: "upload_firmware",
        });

        const overview = await request(server)
          .get("/api/safety/overview")
          .query({ projectDir })
          .set("Authorization", `Bearer ${authToken}`);
        expect(overview.status).toBe(200);
        expect(overview.body.policy.profile).toBeDefined();
        expect(overview.body.automationStates).toMatchObject([
          {
            automationKey: "nightly-health",
            consecutiveFailures: 2,
            consecutiveHardwareWrites: 1,
          },
        ]);

        const reset = await request(server)
          .post("/api/safety/automations/nightly-health/clear")
          .set("Authorization", `Bearer ${authToken}`)
          .send({ projectDir });
        expect(reset.status).toBe(200);
        expect(reset.body.state).toMatchObject({
          automationKey: "nightly-health",
          consecutiveFailures: 0,
          consecutiveHardwareWrites: 1,
          lastHardwareWriteAction: "upload_firmware",
        });
        expect(reset.body.state.cursor).toBeUndefined();
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it("cancels only a task in the selected valid workspace", async () => {
      const projectDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "pio-dashboard-cancel-"),
      );
      try {
        fs.writeFileSync(
          path.join(projectDir, "platformio.ini"),
          "[env:native]\nplatform = native\n",
          "utf8",
        );
        const { registerCommand } =
          await import("../src/utils/command-registry.js");
        await registerCommand(
          {
            id: "dashboard-cancel-command",
            commandDesc: "completed test task",
            timestamp: Date.now(),
            status: "success",
            tasks: [
              {
                taskId: "dashboard-cancel-task",
                type: "test",
                status: "success",
              },
            ],
          },
          projectDir,
        );

        const response = await request(server)
          .post("/api/tasks/dashboard-cancel-task/cancel")
          .set("Authorization", `Bearer ${authToken}`)
          .send({ projectDir });
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          success: true,
          taskId: "dashboard-cancel-task",
          status: "already_terminal",
          processTerminated: false,
        });
      } finally {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    });
  });

  describe("V2 Wrapper Endpoints & Queue Enforcement", () => {
    const mockProjectDir = path.join(os.tmpdir(), "pio-mcp-test-wrapper");

    beforeAll(() => {
      if (!fs.existsSync(mockProjectDir)) {
        fs.mkdirSync(mockProjectDir, { recursive: true });
      }
    });

    afterAll(() => {
      if (fs.existsSync(mockProjectDir)) {
        fs.rmSync(mockProjectDir, { recursive: true, force: true });
      }
    });

    it("should execute check_project and ensure hardware lock is false exactly upon resolution", async () => {
      const { checkProject } = await import("../src/tools/build.js");
      const { hardwareLockManager } =
        await import("../src/utils/lock-manager.js");

      const promise = checkProject(mockProjectDir, "default", false);
      const result = await promise;

      expect(result.success).toBeDefined();
      expect(hardwareLockManager.getLockStatus().isLocked).toBe(false);
    });

    it("should execute run_tests and ensure hardware lock is false exactly upon resolution", async () => {
      const { runTests } = await import("../src/tools/build.js");
      const { hardwareLockManager } =
        await import("../src/utils/lock-manager.js");

      const promise = runTests(mockProjectDir, "default", false);
      const result = await promise;

      expect(result.success).toBeDefined();
      expect(hardwareLockManager.getLockStatus().isLocked).toBe(false);
    });
  });
});
