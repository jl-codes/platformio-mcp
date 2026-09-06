import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { startPortalServer } from "../src/api/server.js";
import { Server as HttpServer } from "http";
import fs from "node:fs";

vi.mock("../src/api/folder-picker.js", () => ({
  pickWorkspaceDirectory: vi.fn(() => "/tmp/invalid-pio-project-test"),
  WorkspacePickerUnavailableError: class extends Error {},
}));

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
  let closePortal: () => Promise<void>;

  beforeAll(async () => {
    process.env.PORTAL_PORT = "0";
    const portal = startPortalServer();
    app = portal.app;
    server = portal.httpServer;
    authToken = portal.authToken;
    closePortal = portal.close;

    await new Promise<void>((resolve) => {
      server.on("listening", () => resolve());
    });
  });

  afterAll(async () => {
    await closePortal();
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
