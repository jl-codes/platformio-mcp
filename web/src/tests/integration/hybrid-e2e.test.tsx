import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// 1. Establish globals for dynamic server routing
let dynamicPort = 0;
let serverAuthToken = "";

// 2. Intercept socket.io-client before it's imported by the React App
vi.mock("socket.io-client", async () => {
  const actual = await vi.importActual<any>("socket.io-client");
  return {
    ...actual,
    io: (url: string, opts: any) => {
      // Force connection to our actual local dynamic test server
      return actual.io(`http://localhost:${dynamicPort}`, {
        ...opts,
        auth: { token: serverAuthToken },
        transports: ['polling', 'websocket']
      });
    }
  };
});

// Import server logic and app AFTER the mock
import { startPortalServer } from "../../../../src/api/server";
import { portalEvents } from "../../../../src/api/events";
import { initProject } from "../../../../src/tools/projects";
import App from "../../../app";

describe("Work Order 4: Hybrid E2E Integration Test", () => {
  let tempProjectDir: string;
  let serverInstance: any;

  beforeAll(async () => {
    // 1. Use the backend's real initProject tool to initialize a native PlatformIO project directory
    tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pio-mcp-hybrid-e2e-"));
    const initResult = await initProject({
      board: "uno",
      framework: "arduino",
      projectDir: tempProjectDir,
    });
    expect(initResult.success).toBe(true);
    
    // Inject Native Environment code into the scaffolded project
    const srcDir = path.join(tempProjectDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, "main.cpp"),
      `#include <Arduino.h>\nvoid setup() { Serial.begin(115200); }\nvoid loop() {}`
    );
    
    const iniContent = fs.readFileSync(path.join(tempProjectDir, "platformio.ini"), "utf-8");
    fs.writeFileSync(
      path.join(tempProjectDir, "platformio.ini"),
      iniContent + `\n\n[env:native]\nplatform = native\n`
    );


    // 2. Boot the actual backend Express Server on a dynamic port
    const portal = startPortalServer(0);
    serverInstance = portal;
    
    // Wait for Express to bind to a port
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        const address = portal.httpServer.address();
        if (address && typeof address !== 'string') {
          dynamicPort = address.port;
          serverAuthToken = portal.authToken;
          clearInterval(check);
          resolve();
        }
      }, 100);
    });

    // 3. Setup dynamic fetch routing so App.tsx can use the Express REST APIs
    const undiciFetch = (await import("undici")).fetch;
    global.fetch = async (input, init) => {
      let url = input.toString();
      if (url.startsWith("/")) {
        url = `http://localhost:${dynamicPort}${url}`;
      } else if (!url.startsWith("http")) {
        url = `http://localhost:${dynamicPort}/${url}`;
      }
      
      const newInit: any = { ...init };
      newInit.headers = { ...newInit.headers, 'Authorization': `Bearer ${serverAuthToken}` };

      return undiciFetch(url, newInit) as any;
    };
  });

  afterAll(async () => {
    // Clean up backend process and filesystem
    if (serverInstance) {
      serverInstance.httpServer.close();
      serverInstance.io.close();
    }
    if (fs.existsSync(tempProjectDir)) {
      fs.rmSync(tempProjectDir, { recursive: true, force: true });
    }
  });

  it("should establish a real connection, execute a native build via UI, and stream output", async () => {
    // Set workspace globally in the backend so socket emits it upon connection
    portalEvents.emitWorkspaceState(tempProjectDir);

    const user = userEvent.setup();
    render(<App />);

    // 1. Wait for websocket connection confirmation
    await waitFor(() => {
      expect(screen.getByText(/SERVER:\s*ONLINE/i)).toBeInTheDocument();
    }, { timeout: 5000 });

    // Ensure tracking correctly hooked into our temp folder
    const folderName = tempProjectDir.split(path.sep).pop()!;
    await waitFor(() => {
      expect(screen.getByText(new RegExp(`AUTO-TRACKING \\(${folderName}\\)`))).toBeInTheDocument();
    });

    // 2. Open Launcher
    const newRunBtn = screen.getByText('NEW RUN');
    await user.click(newRunBtn);

    // Execute Build
    const executeBtn = await screen.findByRole('button', { name: /EXECUTE/i });
    await user.click(executeBtn);

    // 3. Monitor the DOM for real streaming data from the native PIO build!
    // PlatformIO output usually contains "Environment" or "Resolving"
    await waitFor(() => {
      const allText = document.body.textContent || "";
      // Native builds often output: 'Environment    native' or 'Building...'
      // We look for 'Environment' or 'native' in the output, indicating successful stream
      expect(allText).toMatch(/Environment|native|Resolving/i);
    }, { timeout: 25000 });

  }, 35000);
});
