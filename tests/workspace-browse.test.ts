import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { startPortalServer } from "../src/api/server.js";
import { Server as HttpServer } from "http";
import fs from "node:fs";

// Mock child_process for the osascript prompt
vi.mock("child_process", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    execSync: vi.fn((cmd: string) => {
      if (cmd.includes("choose folder") || cmd.includes("zenity")) {
        return "/tmp/invalid-pio-project-test";
      }
      return actual.execSync(cmd);
    })
  };
});

// Mock platformio runner to avoid hangs
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: {
    spawn: vi.fn(),
    executeWithJsonOutput: vi.fn(() => Promise.resolve([])),
  },
  checkPlatformIOInstalled: vi.fn(() => Promise.resolve(true))
}));

describe("Workspace Browse Validation", () => {
  let app: any;
  let server: HttpServer;
  let authToken: string;

  beforeAll(async () => {
    process.env.PORTAL_PORT = "0";
    const portal = startPortalServer();
    app = portal.app;
    server = portal.httpServer;
    authToken = portal.authToken;

    await new Promise<void>((resolve) => {
      server.on("listening", () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("should return 400 when an invalid folder without platformio.ini is selected", async () => {
    // Ensure the mock folder doesn't have a platformio.ini
    if (fs.existsSync("/tmp/invalid-pio-project-test/platformio.ini")) {
      fs.unlinkSync("/tmp/invalid-pio-project-test/platformio.ini");
    }

    const response = await request(server)
      .post("/api/workspaces/browse")
      .set("Authorization", `Bearer ${authToken}`);

    // Since we fixed the missing `await` on `isValidProject`, this should now correctly return 400
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("This folder is not a PlatformIO project");
  });
});
