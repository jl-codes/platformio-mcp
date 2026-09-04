/**
 * Builds the self-contained PlatformIO MCP runtime distributed by the plugin.
 *
 * Provides:
 * - buildCodexPlugin: Bundles the MCP server and copies dashboard assets.
 */

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { syncCodexPlugin } from "./sync-codex-plugin.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = join(REPO_ROOT, "plugins", "platformio-mcp");
const RUNTIME_ROOT = join(PLUGIN_ROOT, "runtime");
const TEXT_RUNTIME_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs"]);

/**
 * Normalizes generated text for stable cross-platform diffs.
 * @param {string} value Source text.
 * @returns {string} LF-delimited text without trailing horizontal whitespace.
 */
function normalizeText(value) {
  return `${value
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .replace(/\n*$/u, "")}\n`;
}

/**
 * Normalizes every generated runtime text file in place.
 * @param {string} root Runtime directory.
 * @returns {void}
 */
function normalizeRuntimeText(root) {
  const visit = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      const absolutePath = join(directory, entry);
      if (statSync(absolutePath).isDirectory()) {
        visit(absolutePath);
      } else {
        const extension = `.${entry.split(".").pop()?.toLowerCase() ?? ""}`;
        if (TEXT_RUNTIME_EXTENSIONS.has(extension)) {
          writeFileSync(
            absolutePath,
            normalizeText(readFileSync(absolutePath, "utf8")),
          );
        }
      }
    }
  };
  visit(root);
}

/**
 * Lists runtime files with deterministic checksums.
 * @param {string} root Runtime directory.
 * @returns {{ path: string, bytes: number, sha256: string }[]} Sorted inventory.
 */
function createInventory(root) {
  const inventory = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      const absolutePath = join(directory, entry);
      const stats = statSync(absolutePath);
      if (stats.isDirectory()) {
        visit(absolutePath);
      } else if (entry !== "inventory.json") {
        const bytes = readFileSync(absolutePath);
        inventory.push({
          path: relative(root, absolutePath).replaceAll("\\", "/"),
          bytes: stats.size,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  };
  visit(root);
  return inventory.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Bundles the MCP server and production dashboard into the plugin directory.
 * @returns {Promise<{ files: number }>} Generated runtime summary.
 */
export async function buildCodexPlugin() {
  const webDist = join(REPO_ROOT, "web", "dist");
  if (!existsSync(webDist)) {
    throw new Error(
      "web/dist is missing; run npm run build:ui before plugin:build.",
    );
  }

  syncCodexPlugin();
  rmSync(RUNTIME_ROOT, { recursive: true, force: true });
  mkdirSync(RUNTIME_ROOT, { recursive: true });

  await build({
    entryPoints: [join(REPO_ROOT, "src", "index.ts")],
    outfile: join(RUNTIME_ROOT, "platformio-mcp.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    sourcemap: false,
    minify: false,
    legalComments: "none",
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
    logLevel: "info",
  });

  cpSync(webDist, join(RUNTIME_ROOT, "web"), { recursive: true });
  normalizeRuntimeText(RUNTIME_ROOT);
  const inventory = createInventory(RUNTIME_ROOT);
  writeFileSync(
    join(RUNTIME_ROOT, "inventory.json"),
    `${JSON.stringify({ schemaVersion: 1, files: inventory }, null, 2)}\n`,
  );
  return { files: inventory.length };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  buildCodexPlugin()
    .then((result) => {
      console.log(`Built Codex plugin runtime with ${result.files} file(s).`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
