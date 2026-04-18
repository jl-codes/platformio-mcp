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
    expect(buildResult.output).toBeDefined();
    expect(buildResult.output).toContain("SUCCESS"); // PIO typically outputs this on success
  }, 120000); // AVR toolchain download & comp can take 1-2 minutes max
});
