import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function runCli(args: string[], cwd: string) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", ...args],
    {
      cwd,
      maxBuffer: 1024 * 1024,
      env: process.env,
    },
  );
  return JSON.parse(stdout) as unknown;
}

describe("CLI agent workflow smoke tests", () => {
  let tempProjectDir: string;
  const repoRoot = process.cwd();

  beforeAll(async () => {
    tempProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "pio-cli-agent-smoke-"));
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
  }, 10000);

  afterAll(async () => {
    await fs.rm(tempProjectDir, { recursive: true, force: true });
  });

  it("runs agent-safe-pin-audit from CLI", async () => {
    const payload = (await runCli(
      [
        "agent-safe-pin-audit",
        "--project-dir",
        tempProjectDir,
        "--board",
        "esp32dev",
        "--json",
      ],
      repoRoot,
    )) as Array<{ pin: number; severity: string }>;

    expect(Array.isArray(payload)).toBe(true);
    expect(payload.some((entry) => entry.pin === 12)).toBe(true);
    expect(payload.some((entry) => entry.severity === "high")).toBe(true);
  });

  it("retrieves agent-last-report from CLI", async () => {
    const payload = (await runCli(
      [
        "agent-last-report",
        "--project-dir",
        tempProjectDir,
        "--json",
      ],
      repoRoot,
    )) as { success: boolean; report?: { tool?: string } };

    expect(payload.success).toBe(true);
    expect(payload.report?.tool).toBe("agent_safe_pin_audit");
  });

  it("returns policy-status from CLI", async () => {
    const payload = (await runCli(
      [
        "policy-status",
        "--project-dir",
        tempProjectDir,
        "--json",
      ],
      repoRoot,
    )) as {
      profile: string;
      allowedOperations: string[];
      approvalRequiredOperations: string[];
    };

    expect(payload.profile).toBeDefined();
    expect(payload.allowedOperations).toContain("agent_safe_pin_audit");
    expect(payload.approvalRequiredOperations).toContain("upload_firmware");
  });
});
