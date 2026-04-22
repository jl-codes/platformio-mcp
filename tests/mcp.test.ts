import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MCPTestHarness } from "./setup.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("PlatformIO MCP Server E2E Integration", () => {
  let harness: MCPTestHarness;
  let tempProjectDir: string;

  beforeAll(async () => {
    tempProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "pio-mcp-e2e-"));
    harness = new MCPTestHarness();
    console.log(`Starting MCP server integration test on tmp folder: ${tempProjectDir}`);
    await harness.connect();
  }, 10000);

  afterAll(async () => {
    await harness.disconnect();
    try {
      if (tempProjectDir) {
        await fs.rm(tempProjectDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn("Failed to cleanup temp dir:", e);
    }
  });

  it("should list available boards", async () => {
    const result = await harness.client.callTool({
      name: "list_boards",
      arguments: { filter: "uno" },
    }) as { content: Array<{ type: string, text: string }> };

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    
    const textContent = result.content[0].text;
    expect(textContent).toContain("Arduino Uno"); // Or at least 'uno' json object
    expect(textContent).toContain("uno");
  });

  it("should initialize a new project", async () => {
    const result = await harness.client.callTool({
      name: "init_project",
      arguments: {
        board: "uno",
        framework: "arduino",
        projectDir: tempProjectDir,
      },
    }) as { content: Array<{ type: string, text: string }> };

    expect(result).toBeDefined();
    
    const textContent = result.content[0].text;
    const parsed = JSON.parse(textContent);
    expect(parsed.success).toBe(true);

    // Verify files were actually created
    const iniContent = await fs.readFile(path.join(tempProjectDir, "platformio.ini"), "utf-8");
    expect(iniContent).toContain("board = uno");
  });

  it("should build the newly initialized project", async () => {
    // Create a dummy main.cpp to satisfy the compiler
    const srcDir = path.join(tempProjectDir, "src");
    // Ensure src dir exists (init handles this, but just in case)
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, "main.cpp"),
      `#include <Arduino.h>\n\nvoid setup() {\n  Serial.begin(115200);\n}\n\nvoid loop() {\n}\n`
    );

    const result = await harness.client.callTool({
      name: "build_project",
      arguments: {
        projectDir: tempProjectDir,
        verbose: true,
      },
    }) as { content: Array<{ type: string, text: string }> };

    const textContent = result.content[0].text;
    const buildResult = JSON.parse(textContent);
    
    expect(buildResult.success).toBe(true);
  }, 120000); // AVR toolchain download & comp can take 1-2 minutes max

  it("should dispatch a build to the background and poll its status", async () => {
    // Fire a background build
    const result = await harness.client.callTool({
      name: "build_project",
      arguments: {
        projectDir: tempProjectDir,
        background: true,
      },
    }) as { content: Array<{ type: string, text: string }> };

    const textContent = result.content[0].text;
    const buildResult = JSON.parse(textContent);
    
    expect(buildResult.status).toBe("running");
    expect(buildResult.pid).toBeDefined();

    // Poll the status immediately
    const pollResult = await harness.client.callTool({
      name: "check_task_status",
      arguments: {
        projectDir: tempProjectDir,
      },
    }) as { content: Array<{ type: string, text: string }> };

    const pollText = pollResult.content[0].text;
    const pollParsed = JSON.parse(pollText);

    expect(pollParsed.status).toBeDefined();
    expect(pollParsed.logTail).toBeDefined();
    
    // Wait for the background build to actually finish so we don't leak processes
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Cleanup any lingering state
    await harness.client.callTool({
      name: "reset_server_state",
      arguments: { projectDir: tempProjectDir }
    });
  }, 30000);

  it("should get specific board info", async () => {
    const result = await harness.client.callTool({
      name: "get_board_info",
      arguments: { boardId: "uno" },
    }) as { content: Array<{ type: string, text: string }> };

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("uno");
    expect(parsed.mcu.toLowerCase()).toContain("atmega328");
  });

  it("should list available devices safely", async () => {
    const result = await harness.client.callTool({
      name: "list_devices",
      arguments: {},
    }) as { content: Array<{ type: string, text: string }> };

    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    // Devices may be empty depending on the host machine, but it shouldn't crash
  });

  it("should clean the initialized project", async () => {
    const result = await harness.client.callTool({
      name: "clean_project",
      arguments: { projectDir: tempProjectDir },
    }) as { content: Array<{ type: string, text: string }> };

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  }, 30000);

  it("should gracefully handle upload bounds when no serial port", async () => {
    // Attempt upload_firmware
    // We expect it to either succeed conceptually and fail on no port found, or throw handled MCP error message.
    const result = await harness.client.callTool({
      name: "upload_firmware",
      arguments: { projectDir: tempProjectDir, port: "/dev/ttyNONEXISTENT" },
    }) as { content: Array<{ type: string, text: string }>, isError?: boolean };

    if (result.isError) {
      expect(result.content[0].text).toContain("Error");
    } else {
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
    }
  }, 60000);

  it("should gracefully handle filesystem upload bounds", async () => {
    const result = await harness.client.callTool({
      name: "upload_filesystem",
      arguments: { projectDir: tempProjectDir, port: "/dev/ttyNONEXISTENT" },
    }) as { content: Array<{ type: string, text: string }>, isError?: boolean };

    if (result.isError) {
      expect(result.content[0].text).toContain("Error");
    } else {
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
    }
  }, 60000);

  it("should search libraries in the registry", async () => {
    const result = await harness.client.callTool({
      name: "search_libraries",
      arguments: { query: "ArduinoJson", limit: 2 },
    }) as { content: Array<{ type: string, text: string }> };

    const parsed = JSON.parse(result.content[0].text);
    // Registry returns array structure or search wrapper
    expect(parsed.items || parsed).toBeDefined(); 
  }, 15000);

  it("should install a library explicitly into the test workspace", async () => {
    const result = await harness.client.callTool({
      name: "install_library",
      arguments: { library: "bblanchon/ArduinoJson", projectDir: tempProjectDir },
    }) as { content: Array<{ type: string, text: string }>, isError?: boolean };

    if (!result.isError) {
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
    } else {
      expect(result.content[0].text).toContain("Error");
    }
  }, 60000);

  it("should list installed libraries for the workspace", async () => {
    const result = await harness.client.callTool({
      name: "list_installed_libraries",
      arguments: { projectDir: tempProjectDir },
    }) as { content: Array<{ type: string, text: string }> };

    const textContent = result.content[0].text;
    expect(typeof textContent).toBe("string");
  });

  it("should acquire and release hardware lock via E2E", async () => {
    // Acquire lock
    const acquireRes = await harness.client.callTool({
      name: "acquire_lock",
      arguments: { sessionId: "foo-bar" },
    }) as { content: Array<{ type: string, text: string }> };
    expect(JSON.parse(acquireRes.content[0].text).success).toBe(true);

    // Get status
    const statusRes = await harness.client.callTool({
      name: "get_lock_status",
      arguments: {},
    }) as { content: Array<{ type: string, text: string }> };
    const statData = JSON.parse(statusRes.content[0].text);
    expect(statData.isLocked).toBe(true);
    expect(statData.sessionId).toBe("foo-bar");

    // Release lock
    const releaseRes = await harness.client.callTool({
      name: "release_lock",
      arguments: { sessionId: "foo-bar" },
    }) as { content: Array<{ type: string, text: string }> };
    expect(JSON.parse(releaseRes.content[0].text).success).toBe(true);
  });

  it("should invoke monitor start, stop and query without crashing", async () => {
    // Since port checking may fail immediately or defer to tree-killing, we just verify protocol flow
    const monitorPort = "/dev/ttyBOGUS";
    
    // Start
    const startRes = await harness.client.callTool({
      name: "start_monitor",
      arguments: { port: monitorPort, projectDir: tempProjectDir },
    }) as { content: Array<{ type: string, text: string }>, isError?: boolean };
    
    if (!startRes.isError) {
      expect(startRes.content[0].text).toBeDefined();
    }

    // Query 
    const queryRes = await harness.client.callTool({
      name: "query_logs",
      arguments: { lines: 5, port: monitorPort, projectDir: tempProjectDir },
    }) as { content: Array<{ type: string, text: string }> };
    expect(queryRes.content[0].text).toBeDefined();

    // Stop
    const stopRes = await harness.client.callTool({
      name: "stop_monitor",
      arguments: { port: monitorPort, projectDir: tempProjectDir },
    }) as { content: Array<{ type: string, text: string }> };
    expect(JSON.parse(stopRes.content[0].text).success).toBeDefined();
  }, 10000);

  it("should reset server state explicitly", async () => {
    const result = await harness.client.callTool({
      name: "reset_server_state",
      arguments: { projectDir: tempProjectDir },
    }) as { content: Array<{ type: string, text: string }> };

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toContain("state has been reset");
  });

  it("should successfully route check_project tool", async () => {
    const result = await harness.client.callTool({
      name: "check_project",
      arguments: { projectDir: tempProjectDir },
    }) as { content: Array<{ type: string, text: string }> };

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBeDefined();
  }, 30000);

  it("should successfully route run_tests tool", async () => {
    const result = await harness.client.callTool({
      name: "run_tests",
      arguments: { projectDir: tempProjectDir },
    }) as { content: Array<{ type: string, text: string }> };

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBeDefined();
  }, 30000);

  it("should successfully route system_info tool", async () => {
    const result = await harness.client.callTool({
      name: "system_info",
      arguments: {},
    }) as { content: Array<{ type: string, text: string }> };

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toBeDefined();
  }, 10000);

  it("should trigger build followed instantly by test without QueueEnforcementError", async () => {
    const p1 = harness.client.callTool({
      name: "build_project",
      arguments: { projectDir: tempProjectDir },
    });
    const p2 = harness.client.callTool({
      name: "run_tests",
      arguments: { projectDir: tempProjectDir },
    });

    const [res1, res2] = await Promise.all([p1, p2]) as any[];
    
    // Neither should have thrown an unhandled exception or queue enforcement error string.
    if (res1.isError) {
      expect(res1.content[0].text).not.toContain("QueueEnforcementError");
    }
    if (res2.isError) {
      expect(res2.content[0].text).not.toContain("QueueEnforcementError");
    }
  }, 60000);



});
