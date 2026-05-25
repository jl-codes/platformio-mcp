import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MCPTestHarness } from "./setup.js";

const describeMcpSmoke =
  process.platform === "win32" ? describe.skip : describe;

async function parseToolPayloadFromText(text: string): Promise<unknown> {
  const spooledPrefix = "Payload too large for context window.";
  if (!text.startsWith(spooledPrefix)) {
    return JSON.parse(text);
  }

  const marker = "spooled to disk at ";
  const markerIdx = text.indexOf(marker);
  if (markerIdx === -1) {
    throw new Error(`Could not resolve spooled payload path from message: ${text}`);
  }
  const pathStart = markerIdx + marker.length;
  const pathEnd = text.indexOf(". Please use your grep_search", pathStart);
  if (pathEnd === -1) {
    throw new Error(`Could not resolve spooled payload terminator from message: ${text}`);
  }
  const payloadPath = text.slice(pathStart, pathEnd).trim();
  const fileContent = await fs.readFile(payloadPath, "utf-8");
  return JSON.parse(fileContent);
}

describeMcpSmoke("MCP agent workflow smoke tests", () => {
  let harness: MCPTestHarness;
  let tempProjectDir: string;

  beforeAll(async () => {
    tempProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "pio-mcp-agent-smoke-"));
    await fs.mkdir(path.join(tempProjectDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempProjectDir, "src", "main.cpp"),
      [
        "#include <Arduino.h>",
        "#define LED_PIN 12",
        "void setup() { pinMode(LED_PIN, OUTPUT); }",
        "void loop() { digitalWrite(LED_PIN, HIGH); }",
      ].join("\n"),
      "utf8",
    );

    harness = new MCPTestHarness();
    await harness.connect();
  }, 15000);

  afterAll(async () => {
    await harness.disconnect();
    await fs.rm(tempProjectDir, { recursive: true, force: true });
  });

  it("runs agent_safe_pin_audit via MCP", async () => {
    const response = (await harness.client.callTool({
      name: "agent_safe_pin_audit",
      arguments: {
        projectDir: tempProjectDir,
        boardId: "esp32dev",
      },
    })) as { content: Array<{ type: string; text: string }> };

    const parsed = (await parseToolPayloadFromText(response.content[0].text)) as Array<{
      pin: number;
      severity: string;
      reason: string;
    }>;

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((finding) => finding.pin === 12)).toBe(true);
    expect(parsed.some((finding) => finding.severity === "high")).toBe(true);
  });

  it("retrieves persisted report via agent_get_last_report", async () => {
    const response = (await harness.client.callTool({
      name: "agent_get_last_report",
      arguments: {
        projectDir: tempProjectDir,
      },
    })) as { content: Array<{ type: string; text: string }> };

    const parsed = (await parseToolPayloadFromText(response.content[0].text)) as {
      success: boolean;
      report?: { tool?: string; payload?: unknown };
    };

    expect(parsed.success).toBe(true);
    expect(parsed.report?.tool).toBe("agent_safe_pin_audit");
    expect(parsed.report?.payload).toBeDefined();
  });

  it("returns policy status via MCP", async () => {
    const response = (await harness.client.callTool({
      name: "get_policy_status",
      arguments: {
        projectDir: tempProjectDir,
      },
    })) as { content: Array<{ type: string; text: string }> };

    const parsed = (await parseToolPayloadFromText(response.content[0].text)) as {
      profile: string;
      allowedOperations: string[];
      approvalRequiredOperations: string[];
    };

    expect(parsed.profile).toBeDefined();
    expect(parsed.allowedOperations).toContain("agent_safe_pin_audit");
    expect(parsed.approvalRequiredOperations).toContain("upload_firmware");
  });
});
