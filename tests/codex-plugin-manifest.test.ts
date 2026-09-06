/**
 * Codex plugin manifest and public-tool coverage contract tests.
 *
 * Provides:
 * - Manifest validation against repository and marketplace metadata.
 * - Coverage validation for every MCP tool currently exposed by the server.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateCodexPlugin } from "../scripts/validate-codex-plugin.mjs";

const REPO_ROOT = process.cwd();
const PLUGIN_ROOT = path.join(REPO_ROOT, "plugins", "platformio-mcp");

/** Reads and parses a repository JSON file. */
function readJson(relativePath: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"),
  );
}

describe("Codex plugin manifest", () => {
  it("validates the package before the generated runtime is built", () => {
    expect(validateCodexPlugin()).toEqual({
      skills: 8,
      runtimePresent: expect.any(Boolean),
    });
  });

  it("keeps package, plugin, and marketplace identities aligned", () => {
    const packageJson = readJson("package.json") as { version: string };
    const manifest = readJson(
      "plugins/platformio-mcp/.codex-plugin/plugin.json",
    ) as {
      name: string;
      version: string;
      interface: {
        defaultPrompt: string[];
        logoDark: string;
        screenshots: string[];
      };
    };
    const marketplace = readJson(".agents/plugins/marketplace.json") as {
      plugins: Array<{ name: string; source: { path: string } }>;
    };

    expect(manifest.name).toBe("platformio-mcp");
    expect(manifest.version).toBe(packageJson.version);
    expect(manifest.interface.defaultPrompt).toHaveLength(3);
    expect(manifest.interface.logoDark).toBe("./assets/logo-dark.png");
    expect(manifest.interface.screenshots).toEqual([
      "./assets/screenshot-dashboard.png",
    ]);
    expect(marketplace.plugins).toContainEqual(
      expect.objectContaining({
        name: manifest.name,
        source: { path: "./plugins/platformio-mcp", source: "local" },
      }),
    );
  });

  it("maps every declared MCP tool to at least one packaged skill", () => {
    const serverSource = fs.readFileSync(
      path.join(REPO_ROOT, "src", "index.ts"),
      "utf8",
    );
    const declaredTools = new Set(
      [...serverSource.matchAll(/name:\s*"([a-z0-9_]+)"/g)].map(
        (match) => match[1],
      ),
    );
    const coverage = readJson("plugins/platformio-mcp/tool-coverage.json") as {
      tools: Record<string, string[]>;
    };

    expect(declaredTools.size).toBe(42);
    expect(new Set(Object.keys(coverage.tools))).toEqual(declaredTools);
    for (const skillNames of Object.values(coverage.tools)) {
      expect(skillNames.length).toBeGreaterThan(0);
      for (const skillName of skillNames) {
        expect(
          fs.existsSync(
            path.join(PLUGIN_ROOT, "skills", skillName, "SKILL.md"),
          ),
        ).toBe(true);
      }
    }
  });
});
