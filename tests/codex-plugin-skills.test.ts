/**
 * Skill packaging and safety-boundary tests for the Codex plugin.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncCodexPlugin } from "../scripts/sync-codex-plugin.mjs";

const SKILLS_ROOT = path.join(
  process.cwd(),
  "plugins",
  "platformio-mcp",
  "skills",
);

describe("Codex plugin skills", () => {
  it("keeps generated source skills synchronized", () => {
    expect(() => syncCodexPlugin({ check: true })).not.toThrow();
  });

  it("packages focused skills with matching frontmatter names", () => {
    const skillNames = fs
      .readdirSync(SKILLS_ROOT)
      .filter((name) => fs.statSync(path.join(SKILLS_ROOT, name)).isDirectory())
      .sort();

    expect(skillNames).toEqual([
      "esp32-flash-monitor",
      "firmware-bringup",
      "hardware-in-the-loop-test",
      "pio-manager",
      "platformio-dashboard",
      "platformio-debug",
      "platformio-monitoring-automation",
      "serial-diagnostics",
    ]);
    for (const skillName of skillNames) {
      const contents = fs.readFileSync(
        path.join(SKILLS_ROOT, skillName, "SKILL.md"),
        "utf8",
      );
      expect(contents).toMatch(
        new RegExp(`^---\\r?\\nname: ${skillName}\\r?$`, "m"),
      );
      expect(contents).not.toContain("[TODO:");
    }
  });

  it("keeps browser launch interactive and scheduled monitoring UI-free", () => {
    const dashboardSkill = fs.readFileSync(
      path.join(SKILLS_ROOT, "platformio-dashboard", "SKILL.md"),
      "utf8",
    );
    const automationSkill = fs.readFileSync(
      path.join(SKILLS_ROOT, "platformio-monitoring-automation", "SKILL.md"),
      "utf8",
    );

    expect(dashboardSkill).toContain("`open: false`");
    expect(dashboardSkill).toContain(
      "Never open or refresh the dashboard from a scheduled task",
    );
    expect(automationSkill).toContain(
      "Scheduled runs never open the dashboard",
    );
    expect(automationSkill).toContain("refuse unattended flashing");
  });
});
