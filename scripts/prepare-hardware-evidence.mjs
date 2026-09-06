#!/usr/bin/env node

/**
 * Produces a bounded, redacted hardware-evidence artifact for CI upload.
 * Raw workspace logs remain on the self-hosted runner and are never uploaded.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const SAFE_EXTENSIONS = new Set([".json", ".jsonl", ".log", ".txt", ".xml"]);
const SOURCE_DIRECTORIES = [
  ["workspace-logs", ".pio-mcp-workspace", "logs"],
  ["workspace-audit", ".pio-mcp-workspace", "audit"],
];

/**
 * Redacts credentials, machine identity, and physical-device identifiers.
 *
 * @param {string} input Raw text from a bounded local evidence file.
 * @returns {{ text: string, redactions: number }} Sanitized content and count.
 */
export function sanitizeHardwareEvidence(input) {
  let text = input;
  let redactions = 0;
  const replace = (pattern, replacement) => {
    text = text.replace(pattern, (...args) => {
      redactions += 1;
      return typeof replacement === "function"
        ? replacement(...args)
        : replacement;
    });
  };

  replace(
    /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/giu,
    "[REDACTED_PRIVATE_KEY]",
  );
  replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED_SECRET]");
  replace(
    /(["'])(password|passwd|token|api[_-]?key|secret|wifi[_-]?(?:password|passphrase))\1(\s*:\s*)(["'])[^"'\r\n]*\4/giu,
    (_match, quote, key, separator) =>
      `${quote}${key}${quote}${separator}${quote}[REDACTED_SECRET]${quote}`,
  );
  replace(
    /\b(password|passwd|token|api[_-]?key|secret|wifi[_-]?(?:password|passphrase))\b(\s*[=:]\s*)(["']?)[^\s,"'};]+\3/giu,
    (_match, key, separator) => `${key}${separator}[REDACTED_SECRET]`,
  );
  replace(/[A-Za-z]:\\Users\\[^\\\s"'/:]+/gu, "[REDACTED_HOME]");
  replace(/\/(?:Users|home)\/[^/\s"']+/gu, "[REDACTED_HOME]");
  replace(
    /\bCOM\d{1,3}\b|\/dev\/(?:tty|cu\.)[A-Za-z0-9._-]+/giu,
    "[REDACTED_PORT]",
  );
  replace(/\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/giu, "[REDACTED_MAC]");
  replace(
    /(["'])(serial(?:_number)?|device[_-]?fingerprint|target[_-]?binding[_-]?digest|hwid)\1(\s*:\s*)(["'])[^"'\r\n]*\4/giu,
    (_match, quote, _key, separator) =>
      `${quote}device_id${quote}${separator}${quote}[REDACTED_DEVICE_ID]${quote}`,
  );
  replace(
    /\b(?:serial(?:_number)?|device[_-]?fingerprint|target[_-]?binding[_-]?digest|hwid)\b(\s*[=:]\s*)(["']?)[^\s,"'};]+\2/giu,
    (_match, separator) => `device_id${separator}[REDACTED_DEVICE_ID]`,
  );

  return { text, redactions };
}

/**
 * Recursively discovers regular text evidence without following links.
 *
 * @param {string} directory Exact source directory.
 * @returns {string[]} Absolute file paths.
 */
function listEvidenceFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      files.push(...listEvidenceFiles(entryPath));
    } else if (
      entry.isFile() &&
      SAFE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      files.push(entryPath);
    }
  }
  return files;
}

/**
 * Builds the upload-safe evidence directory from exact workspace sources.
 *
 * @param {{ repositoryRoot?: string, projectDirectory?: string, outputDirectory?: string }} [options] Paths for CI or tests.
 * @returns {{ outputDirectory: string, files: Array<object>, skipped: Array<object> }} Artifact manifest.
 */
export function prepareHardwareEvidence(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const configuredProject =
    options.projectDirectory ?? process.env.PIO_HIL_PROJECT_DIR;
  const projectDirectory = configuredProject
    ? path.resolve(repositoryRoot, configuredProject)
    : repositoryRoot;
  const relativeProject = path.relative(repositoryRoot, projectDirectory);
  if (
    relativeProject === ".." ||
    relativeProject.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeProject)
  ) {
    throw new Error(
      "Hardware evidence project must be inside the repository root.",
    );
  }
  const outputDirectory = path.resolve(
    options.outputDirectory ??
      path.join(repositoryRoot, "test-results", "hardware-evidence"),
  );
  const defaultOutputRoot = path.join(repositoryRoot, "test-results");
  const relativeOutput = path.relative(repositoryRoot, outputDirectory);
  if (
    !relativeOutput ||
    relativeOutput === ".." ||
    relativeOutput.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeOutput)
  ) {
    throw new Error(
      "Hardware evidence output must be inside the repository root.",
    );
  }
  if (
    options.outputDirectory === undefined &&
    path.dirname(outputDirectory) !== defaultOutputRoot
  ) {
    throw new Error("Default hardware evidence output escaped test-results.");
  }

  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA || undefined,
    files: [],
    skipped: [],
  };
  let totalBytes = 0;

  for (const [logicalRoot, ...segments] of SOURCE_DIRECTORIES) {
    const sourceDirectory = path.join(projectDirectory, ...segments);
    for (const sourcePath of listEvidenceFiles(sourceDirectory).sort()) {
      const stat = fs.statSync(sourcePath);
      const relativePath = path.relative(sourceDirectory, sourcePath);
      const logicalPath = path.posix.join(
        logicalRoot,
        relativePath.split(path.sep).join("/"),
      );
      if (
        stat.size > MAX_FILE_BYTES ||
        totalBytes + stat.size > MAX_TOTAL_BYTES
      ) {
        manifest.skipped.push({
          logicalPath,
          reason: "size_limit",
          bytes: stat.size,
        });
        continue;
      }

      const raw = fs.readFileSync(sourcePath, "utf8");
      const sanitized = sanitizeHardwareEvidence(raw);
      const outputPath = path.join(outputDirectory, `${logicalPath}.txt`);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, sanitized.text, {
        encoding: "utf8",
        mode: 0o600,
      });
      const bytes = Buffer.byteLength(sanitized.text);
      totalBytes += bytes;
      manifest.files.push({
        logicalPath,
        artifactPath: path
          .relative(outputDirectory, outputPath)
          .split(path.sep)
          .join("/"),
        bytes,
        redactions: sanitized.redactions,
        sha256: crypto
          .createHash("sha256")
          .update(sanitized.text)
          .digest("hex"),
      });
    }
  }

  fs.writeFileSync(
    path.join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return { outputDirectory, ...manifest };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = prepareHardwareEvidence();
  process.stdout.write(
    `${JSON.stringify({ outputDirectory: result.outputDirectory, files: result.files.length, skipped: result.skipped.length })}\n`,
  );
}
