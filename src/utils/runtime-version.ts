/**
 * Resolves the package identity for source, npm, plugin and wheel entry points.
 * Provides: readRuntimeVersion, shared by CLI output and MCP server metadata.
 */
import { readFileSync } from "node:fs";

/** Read only the known package/plugin manifest beside the invoking entry point. */
export function readRuntimeVersion(entryUrl: string): string {
  for (const relative of ["../package.json", "../.codex-plugin/plugin.json"]) {
    try {
      const manifest = JSON.parse(readFileSync(new URL(relative, entryUrl), "utf8")) as {
        name?: string;
        version?: string;
      };
      if (manifest.name === "platformio-mcp" && typeof manifest.version === "string" &&
          /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)) {
        return manifest.version;
      }
    } catch {
      // The alternate layout may contain the manifest; never invent a version.
    }
  }
  return "unknown";
}
