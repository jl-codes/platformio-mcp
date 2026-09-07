/**
 * Synchronizes source-owned skills, assets, and version metadata into the plugin.
 *
 * Provides:
 * - syncCodexPlugin: Updates or verifies deterministic plugin copies.
 */

import {
  copyFileSync,
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

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = join(REPO_ROOT, "plugins", "platformio-mcp");
const PLUGIN_SKILLS_ROOT = join(PLUGIN_ROOT, "skills");
/** Repository marketplace whose visible brand follows the plugin manifest. */
const MARKETPLACE_PATH = join(
  REPO_ROOT,
  ".agents",
  "plugins",
  "marketplace.json",
);

/** Source skills included in the initial plugin distribution. */
const SOURCE_SKILLS = [
  [".agents/skills/pio-manager", "pio-manager"],
  [".skills/firmware-bringup", "firmware-bringup"],
  [".skills/platformio-debug", "platformio-debug"],
  [".skills/esp32-flash-monitor", "esp32-flash-monitor"],
  [".skills/serial-diagnostics", "serial-diagnostics"],
  [".skills/hardware-in-the-loop-test", "hardware-in-the-loop-test"],
  [".skills/platformio-dashboard", "platformio-dashboard"],
  [
    ".skills/platformio-monitoring-automation",
    "platformio-monitoring-automation",
  ],
];

/** Binary assets copied from the repository's maintained artwork. */
const ASSET_COPIES = [
  ["docs/assets/pio_agent.png", "assets/icon.png"],
  ["docs/assets/pio_agent.png", "assets/logo.png"],
  ["docs/assets/pio_agent.png", "assets/logo-dark.png"],
];

/**
 * Returns sorted relative file paths beneath a directory.
 * @param {string} root Directory to inspect.
 * @returns {string[]} Stable relative file list.
 */
function listFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      const absolutePath = join(directory, entry);
      if (statSync(absolutePath).isDirectory()) {
        visit(absolutePath);
      } else {
        files.push(relative(root, absolutePath).replaceAll("\\", "/"));
      }
    }
  };
  visit(root);
  return files;
}

/**
 * Confirms a generated destination remains inside the plugin root.
 * @param {string} destination Candidate destination path.
 * @returns {void}
 */
function assertPluginDestination(destination) {
  const relativePath = relative(PLUGIN_ROOT, resolve(destination));
  if (relativePath.startsWith("..") || relativePath === "") {
    throw new Error(`Refusing to write outside plugin content: ${destination}`);
  }
}

/**
 * Normalizes generated text copies for stable cross-platform diffs.
 * @param {string} value Source text.
 * @returns {string} LF-delimited text without trailing horizontal whitespace.
 */
function normalizeText(value) {
  return `${value
    .replace(/\r+\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .replace(/\n*$/u, "")}\n`;
}

/**
 * Compares or copies one directory recursively.
 * @param {string} source Source directory.
 * @param {string} destination Plugin destination directory.
 * @param {boolean} check Whether to verify without writing.
 * @param {string[]} drift Mutable drift report.
 * @returns {void}
 */
function syncDirectory(source, destination, check, drift) {
  assertPluginDestination(destination);
  const sourceFiles = listFiles(source);
  const destinationFiles = listFiles(destination);

  if (
    sourceFiles.length !== destinationFiles.length ||
    sourceFiles.some((file, index) => file !== destinationFiles[index])
  ) {
    drift.push(relative(REPO_ROOT, destination));
  } else {
    for (const file of sourceFiles) {
      const sourceText = normalizeText(
        readFileSync(join(source, file), "utf8"),
      );
      const destinationText = readFileSync(join(destination, file), "utf8");
      if (sourceText !== destinationText) {
        drift.push(join(relative(REPO_ROOT, destination), file));
      }
    }
  }

  if (check) return;
  rmSync(destination, { recursive: true, force: true });
  for (const file of sourceFiles) {
    const destinationFile = join(destination, file);
    mkdirSync(dirname(destinationFile), { recursive: true });
    writeFileSync(
      destinationFile,
      normalizeText(readFileSync(join(source, file), "utf8")),
    );
  }
}

/**
 * Compares or copies one binary asset.
 * @param {string} source Source asset path.
 * @param {string} destination Plugin asset path.
 * @param {boolean} check Whether to verify without writing.
 * @param {string[]} drift Mutable drift report.
 * @returns {void}
 */
function syncFile(source, destination, check, drift) {
  assertPluginDestination(destination);
  const matches =
    existsSync(destination) &&
    readFileSync(source).equals(readFileSync(destination));
  if (!matches) drift.push(relative(REPO_ROOT, destination));
  if (check || matches) return;
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

/**
 * Synchronizes all generated plugin content.
 * @param {{ check?: boolean }} [options] Synchronization mode.
 * @returns {{ drift: string[] }} Drift details.
 */
export function syncCodexPlugin(options = {}) {
  const check = options.check ?? false;
  const drift = [];

  for (const [sourcePath, skillName] of SOURCE_SKILLS) {
    syncDirectory(
      join(REPO_ROOT, sourcePath),
      join(PLUGIN_SKILLS_ROOT, skillName),
      check,
      drift,
    );
  }

  for (const [sourcePath, destinationPath] of ASSET_COPIES) {
    syncFile(
      join(REPO_ROOT, sourcePath),
      join(PLUGIN_ROOT, destinationPath),
      check,
      drift,
    );
  }

  const packageJson = JSON.parse(
    readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
  );
  const manifestPath = join(PLUGIN_ROOT, ".codex-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.version !== packageJson.version) {
    drift.push(relative(REPO_ROOT, manifestPath));
    if (!check) {
      manifest.version = packageJson.version;
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }

  const marketplace = JSON.parse(readFileSync(MARKETPLACE_PATH, "utf8"));
  const displayName = manifest.interface?.displayName;
  if (marketplace.interface?.displayName !== displayName) {
    drift.push(relative(REPO_ROOT, MARKETPLACE_PATH));
    if (!check) {
      marketplace.interface ??= {};
      marketplace.interface.displayName = displayName;
      writeFileSync(
        MARKETPLACE_PATH,
        `${JSON.stringify(marketplace, null, 2)}\n`,
      );
    }
  }

  if (check && drift.length > 0) {
    throw new Error(
      `Codex plugin content is stale:\n- ${[...new Set(drift)].join("\n- ")}`,
    );
  }

  return { drift: [...new Set(drift)] };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const result = syncCodexPlugin({ check });
  console.log(
    check
      ? "Codex plugin generated content is synchronized."
      : `Synchronized Codex plugin content (${result.drift.length} updated path(s)).`,
  );
}
