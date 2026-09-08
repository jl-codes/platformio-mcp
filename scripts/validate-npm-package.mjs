#!/usr/bin/env node
/**
 * Validates the exact file set npm would place in the PIO Agent tarball.
 *
 * Provides:
 * - A dry-run pack inspection that cannot invoke lifecycle scripts recursively.
 * - Required runtime checks for the CLI, dashboard, marketplace, and plugin.
 * - Rejection of mutable workspace state, logs, credentials, and test artifacts.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Thin npm packages that expose supported names for the canonical CLI. */
const COMPATIBILITY_PACKAGES = ["pio-mcp", "pio-agent"];

/** Files that make the published server and Codex plugin usable. */
const REQUIRED_FILES = [
  ".agents/plugins/marketplace.json",
  "build/cli.js",
  "build/index.js",
  "plugins/platformio-mcp/.codex-plugin/plugin.json",
  "plugins/platformio-mcp/.mcp.json",
  "plugins/platformio-mcp/runtime/inventory.json",
  "plugins/platformio-mcp/runtime/platformio-mcp.mjs",
  "plugins/platformio-mcp/runtime/web/index.html",
  "web/dist/index.html",
];

/** Files required for each published compatibility package. */
const COMPATIBILITY_REQUIRED_FILES = ["README.md", "bin.js", "package.json"];

/** Content that must never leave a developer or CI workspace in an npm package. */
const FORBIDDEN_PATHS = [
  /(^|\/)\.env(?:$|[./])/u,
  /(^|\/)\.git(?:$|\/)/u,
  /(^|\/)\.pio-mcp-workspace(?:$|\/)/u,
  /(^|\/)\.platformio-mcp(?:$|\/)/u,
  /(^|\/)node_modules(?:$|\/)/u,
  /(^|\/)test-results(?:$|\/)/u,
  /(^|\/)playwright-report(?:$|\/)/u,
  /(^|\/)(?:server\.log|workspaces\.json|global-events\.jsonl)$/u,
];

/** High-confidence credential forms that must not appear in packed text. */
const SECRET_PATTERNS = [
  {
    name: "private key",
    pattern: /-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/u,
  },
  { name: "npm token", pattern: /\bnpm_[A-Za-z0-9]{36,}\b/u },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/u },
  { name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u },
];

/**
 * Executes npm using the active npm CLI when called from an npm lifecycle.
 * @returns {{ command: string, args: string[] }} Portable npm invocation.
 */
function npmInvocation() {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath],
    };
  }
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: [],
  };
}

/**
 * Reads a JSON file relative to the repository root.
 * @param {string} path Repository-relative JSON path.
 * @returns {Record<string, any>} Parsed JSON object.
 */
function readJson(path) {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, path), "utf8"));
}

/**
 * Runs a lifecycle-free npm pack inspection for one package directory.
 * @param {string} packagePath Repository-relative package path.
 * @returns {Record<string, any>} npm pack report.
 */
function inspectPackage(packagePath) {
  const invocation = npmInvocation();
  const result = spawnSync(
    invocation.command,
    [
      ...invocation.args,
      "pack",
      packagePath,
      "--dry-run",
      "--ignore-scripts",
      "--json",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      shell: false,
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }

  let report;
  try {
    [report] = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Unable to parse npm pack report: ${error.message}`);
  }
  if (!report || !Array.isArray(report.files)) {
    throw new Error("npm pack did not return a package file manifest.");
  }
  return report;
}

/**
 * Validates package identity and the required and forbidden file contracts.
 * @param {Record<string, any>} report npm pack report.
 * @param {Record<string, any>} packageJson Expected package metadata.
 * @param {string[]} requiredFiles Required package-relative paths.
 * @returns {string[]} Validated normalized package paths.
 */
function validateReport(report, packageJson, requiredFiles) {
  const paths = report.files.map(({ path }) => path.replaceAll("\\", "/"));
  const pathSet = new Set(paths);
  const missing = requiredFiles.filter((path) => !pathSet.has(path));
  const forbidden = paths.filter((path) =>
    FORBIDDEN_PATHS.some((pattern) => pattern.test(path)),
  );

  if (
    report.name !== packageJson.name ||
    report.version !== packageJson.version
  ) {
    throw new Error(
      `Package identity mismatch: expected ${packageJson.name}@${packageJson.version}, ` +
        `received ${report.name}@${report.version}.`,
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `Required npm files are missing:\n- ${missing.join("\n- ")}`,
    );
  }
  if (forbidden.length > 0) {
    throw new Error(
      `Forbidden mutable or sensitive npm files detected:\n- ${forbidden.join("\n- ")}`,
    );
  }
  return paths;
}

/**
 * Scans packed text files for high-confidence credential signatures.
 * @param {string} packageRoot Absolute package source directory.
 * @param {string[]} paths Validated package-relative paths.
 * @returns {void}
 */
function scanPackedText(packageRoot, paths) {
  const findings = [];
  for (const path of paths) {
    const absolutePath = resolve(packageRoot, path);
    const relativePath = relative(packageRoot, absolutePath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error(`npm reported a path outside its package root: ${path}`);
    }

    const contents = readFileSync(absolutePath);
    if (contents.includes(0)) continue;
    const text = contents.toString("utf8");
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(text)) findings.push(`${path}: ${name}`);
    }
  }

  if (findings.length > 0) {
    throw new Error(
      `Potential credentials detected in npm files:\n- ${findings.join("\n- ")}`,
    );
  }
}

const packageJson = readJson("package.json");
const report = inspectPackage(".");
const paths = validateReport(report, packageJson, REQUIRED_FILES);
scanPackedText(REPO_ROOT, paths);

const compatibilityResults = COMPATIBILITY_PACKAGES.map((packageName) => {
  const packageRoot = resolve(REPO_ROOT, "packages", packageName);
  const compatibilityPackageJson = readJson(
    `packages/${packageName}/package.json`,
  );
  const compatibilityReport = inspectPackage(`./packages/${packageName}`);
  const compatibilityPaths = validateReport(
    compatibilityReport,
    compatibilityPackageJson,
    COMPATIBILITY_REQUIRED_FILES,
  );
  scanPackedText(packageRoot, compatibilityPaths);

  if (compatibilityPackageJson.version !== packageJson.version) {
    throw new Error(
      `${packageName} and platformio-mcp package versions differ.`,
    );
  }
  if (
    compatibilityPackageJson.dependencies?.["platformio-mcp"] !==
    `^${packageJson.version}`
  ) {
    throw new Error(
      `${packageName} does not depend on the matching 3.x package line.`,
    );
  }

  return { report: compatibilityReport, paths: compatibilityPaths };
});

for (const { report: packageReport, paths: packagePaths } of [
  { report, paths },
  ...compatibilityResults,
]) {
  console.log(
    `Validated ${packageReport.name}@${packageReport.version}: ` +
      `${packagePaths.length} files, ${packageReport.size} packed bytes, ` +
      `${packageReport.unpackedSize} unpacked bytes.`,
  );
}
