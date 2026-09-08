/**
 * Validates the repository marketplace and packaged PIO Agent plugin.
 *
 * Provides:
 * - validateCodexPlugin: Checks manifest, paths, skills, assets, and runtime.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Resolves a relative plugin path and rejects escapes.
 * @param {string} pathValue Manifest path value.
 * @param {string} pluginRoot Absolute plugin root.
 * @returns {string} Absolute path within the plugin.
 */
function resolvePluginPath(pathValue, pluginRoot) {
  if (typeof pathValue !== "string" || !pathValue.startsWith("./")) {
    throw new Error(`Plugin path must start with ./: ${String(pathValue)}`);
  }
  const destination = resolve(pluginRoot, pathValue);
  const relativePath = relative(pluginRoot, destination);
  if (relativePath.startsWith("..") || relativePath === "") {
    throw new Error(`Plugin path escapes the plugin root: ${pathValue}`);
  }
  return destination;
}

/**
 * Reads dimensions from a PNG IHDR chunk without adding image dependencies.
 * @param {string} imagePath Absolute PNG path.
 * @param {string} pluginRoot Absolute plugin root used for safe diagnostics.
 * @returns {{ width: number, height: number, bytes: number }} Image metadata.
 */
function readPngMetadata(imagePath, pluginRoot) {
  const contents = readFileSync(imagePath);
  if (
    contents.length < 24 ||
    contents.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    contents.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error(
      `Plugin asset is not a valid PNG: ${relative(pluginRoot, imagePath)}`,
    );
  }
  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
    bytes: contents.length,
  };
}

/**
 * Validates the packaged plugin and repository marketplace.
 * @param {{ requireRuntime?: boolean, repoRoot?: string }} [options] Validation options.
 * @returns {{ skills: number, runtimePresent: boolean }} Validation summary.
 */
export function validateCodexPlugin(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const pluginRoot = join(repoRoot, "plugins", "platformio-mcp");
  const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
  const marketplacePath = join(
    repoRoot,
    ".agents",
    "plugins",
    "marketplace.json",
  );
  const packageJson = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
  const errors = [];

  if (manifest.name !== "platformio-mcp")
    errors.push("Plugin name must be platformio-mcp.");
  if (manifest.interface?.displayName !== "PIO Agent")
    errors.push("Plugin display name must be PIO Agent.");
  if (manifest.version !== packageJson.version)
    errors.push("Plugin/package versions differ.");
  if (
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      manifest.version,
    )
  ) {
    errors.push("Plugin version is not semantic versioning.");
  }
  if (JSON.stringify(manifest).includes("[TODO:"))
    errors.push("Plugin manifest has TODO markers.");

  const assetPaths = [
    manifest.interface?.composerIcon,
    manifest.interface?.logo,
    manifest.interface?.logoDark,
    ...(Array.isArray(manifest.interface?.screenshots)
      ? manifest.interface.screenshots
      : []),
  ];
  for (const pathValue of [
    manifest.skills,
    manifest.mcpServers,
    ...assetPaths,
  ]) {
    try {
      const absolutePath = resolvePluginPath(pathValue, pluginRoot);
      if (!existsSync(absolutePath))
        errors.push(`Missing plugin path: ${pathValue}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const pathValue of assetPaths) {
    try {
      const absolutePath = resolvePluginPath(pathValue, pluginRoot);
      if (!existsSync(absolutePath)) continue;
      const image = readPngMetadata(absolutePath, pluginRoot);
      const isScreenshot = manifest.interface?.screenshots?.includes(pathValue);
      if (image.bytes > 5 * 1024 * 1024) {
        errors.push(`Plugin image exceeds 5 MiB: ${pathValue}`);
      }
      if (image.width < 64 || image.height < 64) {
        errors.push(`Plugin image is smaller than 64x64: ${pathValue}`);
      }
      if (isScreenshot && (image.width < 800 || image.height < 450)) {
        errors.push(`Plugin screenshot is smaller than 800x450: ${pathValue}`);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const prompts = manifest.interface?.defaultPrompt;
  if (!Array.isArray(prompts) || prompts.length === 0 || prompts.length > 3) {
    errors.push("Plugin must define one to three starter prompts.");
  } else if (
    prompts.some((prompt) => typeof prompt !== "string" || prompt.length > 128)
  ) {
    errors.push(
      "Starter prompts must be strings no longer than 128 characters.",
    );
  }

  const marketplaceEntry = marketplace.plugins?.find(
    (entry) => entry?.name === "platformio-mcp",
  );
  if (!marketplaceEntry) errors.push("Marketplace entry is missing.");
  if (marketplace.interface?.displayName !== "PIO Agent") {
    errors.push("Marketplace display name must be PIO Agent.");
  }
  if (marketplaceEntry?.source?.path !== "./plugins/platformio-mcp") {
    errors.push("Marketplace source path is incorrect.");
  }
  if (
    !marketplaceEntry?.policy?.installation ||
    !marketplaceEntry?.policy?.authentication
  ) {
    errors.push("Marketplace policy is incomplete.");
  }

  const skillsRoot = resolvePluginPath(manifest.skills, pluginRoot);
  const skillDirectories = existsSync(skillsRoot)
    ? readdirSync(skillsRoot)
        .map((name) => join(skillsRoot, name))
        .filter((path) => statSync(path).isDirectory())
    : [];
  for (const skillDirectory of skillDirectories) {
    const skillPath = join(skillDirectory, "SKILL.md");
    if (!existsSync(skillPath)) {
      errors.push(
        `Skill is missing SKILL.md: ${relative(pluginRoot, skillDirectory)}`,
      );
      continue;
    }
    const contents = readFileSync(skillPath, "utf8");
    if (!contents.startsWith("---\n") && !contents.startsWith("---\r\n")) {
      errors.push(
        `Skill frontmatter is missing: ${relative(pluginRoot, skillPath)}`,
      );
    }
    if (contents.includes("[TODO:")) {
      errors.push(
        `Skill contains TODO markers: ${relative(pluginRoot, skillPath)}`,
      );
    }
  }

  const runtimePath = join(pluginRoot, "runtime", "platformio-mcp.mjs");
  const runtimePresent = existsSync(runtimePath);
  if (options.requireRuntime && !runtimePresent)
    errors.push("Bundled runtime is missing.");
  if (runtimePresent) {
    const inventoryPath = join(pluginRoot, "runtime", "inventory.json");
    if (!existsSync(inventoryPath)) {
      errors.push("Bundled runtime inventory is missing.");
    } else {
      const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
      for (const entry of Array.isArray(inventory.files)
        ? inventory.files
        : []) {
        const absolutePath = resolve(join(pluginRoot, "runtime"), entry.path);
        const runtimeRelativePath = relative(
          join(pluginRoot, "runtime"),
          absolutePath,
        );
        if (runtimeRelativePath.startsWith("..") || !existsSync(absolutePath)) {
          errors.push(`Runtime inventory path is invalid: ${entry.path}`);
          continue;
        }
        const bytes = readFileSync(absolutePath);
        const checksum = createHash("sha256").update(bytes).digest("hex");
        if (bytes.length !== entry.bytes || checksum !== entry.sha256) {
          errors.push(`Runtime inventory mismatch: ${entry.path}`);
        }
      }
    }

    const runtimeText = readFileSync(runtimePath, "utf8");
    for (const forbiddenPath of [repoRoot, repoRoot.replaceAll("\\", "/")]) {
      if (runtimeText.includes(forbiddenPath)) {
        errors.push(
          "Bundled runtime contains a machine-specific repository path.",
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Codex plugin validation failed:\n- ${errors.join("\n- ")}`,
    );
  }
  return { skills: skillDirectories.length, runtimePresent };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const result = validateCodexPlugin({
      requireRuntime: process.argv.includes("--require-runtime"),
    });
    console.log(
      `Codex plugin is valid (${result.skills} skills, runtime ${result.runtimePresent ? "present" : "not built"}).`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
