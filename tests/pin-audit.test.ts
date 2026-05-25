import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentSafePinAudit } from "../src/tools/agent.js";

const createdDirs: string[] = [];

function makeTempProject(contents: string): string {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pio-pin-audit-"));
  createdDirs.push(projectDir);
  fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "src", "main.cpp"), contents, "utf8");
  return projectDir;
}

describe("agent_safe_pin_audit", () => {
  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flags ESP32 strapping pin usage as high severity", async () => {
    const projectDir = makeTempProject(`
      #include <Arduino.h>
      #define LED_PIN 12
      void setup() {
        pinMode(LED_PIN, OUTPUT);
      }
      void loop() {
        digitalWrite(LED_PIN, HIGH);
      }
    `);

    const findings = await agentSafePinAudit(projectDir, "esp32dev");
    const pin12 = findings.find((item) => item.pin === 12);

    expect(pin12).toBeDefined();
    expect(pin12?.severity).toBe("high");
    expect(pin12?.reason).toContain("strapping");
    expect(pin12?.saferAlternatives).toContain(25);
  });

  it("flags input-only output writes on ESP32 pins", async () => {
    const projectDir = makeTempProject(`
      #include <Arduino.h>
      void setup() {
        digitalWrite(34, HIGH);
      }
      void loop() {}
    `);

    const findings = await agentSafePinAudit(projectDir, "esp32dev");
    const pin34 = findings.find((item) => item.pin === 34);
    expect(pin34).toBeDefined();
    expect(pin34?.severity).toBe("high");
  });
});
