/**
 * Lossless Codex TOML launch configuration edits and user-config discovery.
 * Provides mergeCodexToml, findBlockRange and resolveCodexConfigPath.
 */
import os from "node:os";
import path from "node:path";
import { parseTOML, getStaticTOMLValue } from "toml-eslint-parser";

/** Parses without including potentially secret source text in diagnostics. */
function parseConfig(source) {
  try {
    return parseTOML(source, { tomlVersion: "1.0" });
  } catch {
    throw new Error(
      "Codex configuration is invalid TOML. Repair it before installing; the file was not changed.",
    );
  }
}

/** Finds a real table, ignoring header-like text inside multiline strings. */
export function findBlockRange(source) {
  const table = parseConfig(source).body[0].body.find(
    (node) =>
      node.type === "TOMLTable" &&
      JSON.stringify(node.resolvedKey) === '["mcp_servers","platformio"]',
  );
  return table ? { start: table.range[0], end: table.range[1] } : null;
}

/**
 * Changes launch values only, supporting quoted/dotted keys and inline tables.
 * @param {string} source Existing TOML document.
 * @returns {string} Validated document retaining other source bytes.
 */
export function mergeCodexToml(source) {
  const ast = parseConfig(source);
  const parsed = getStaticTOMLValue(ast);
  const server = parsed.mcp_servers?.platformio;
  if (
    server !== undefined &&
    (!server || typeof server !== "object" || Array.isArray(server))
  ) {
    throw new Error(
      "The existing PlatformIO server must be a TOML table; the file was not changed.",
    );
  }
  if (server?.url !== undefined) {
    throw new Error(
      "The existing PlatformIO server uses a remote URL. Select a different server name or remove that entry before installing a local server.",
    );
  }
  const target = ["mcp_servers", "platformio"];
  const entries = [];
  const containers = [];
  function visit(container, prefix) {
    containers.push({ node: container, path: prefix });
    for (const child of container.body) {
      if (child.type === "TOMLTable") visit(child, child.resolvedKey);
      else {
        const fullPath = [...prefix, ...getStaticTOMLValue(child.key)];
        entries.push({ node: child, path: fullPath });
        if (child.value.type === "TOMLInlineTable")
          visit(child.value, fullPath);
      }
    }
  }
  visit(ast.body[0], []);
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  // Retain runtime flags such as --policy-file when refreshing an npm launcher.
  const priorArgs = Array.isArray(server?.args) ? server.args : [];
  const packageIndex = priorArgs.findIndex(
    (arg) =>
      typeof arg === "string" &&
      /^(platformio-mcp|pio-agent|pio-mcp)(@[^\s]+)?$/u.test(arg),
  );
  const runtimeArgs =
    packageIndex >= 0 ? priorArgs.slice(packageIndex + 1) : [];
  // An existing custom launcher may use Node, a wrapper or a pinned interpreter.
  // Keep its arguments intact rather than silently discarding permission selectors.
  const customLaunch = packageIndex < 0 && priorArgs.length > 0;
  const desired = {
    command:
      customLaunch && typeof server?.command === "string"
        ? server.command
        : command,
    args: customLaunch
      ? priorArgs
      : [
          "-y",
          "platformio-mcp",
          ...(runtimeArgs.length ? runtimeArgs : ["--open-dashboard-on-start"]),
        ],
  };
  const edits = [];
  const missing = [];
  for (const [key, value] of Object.entries(desired)) {
    const fullPath = [...target, key];
    const existing = entries.find(
      (entry) => JSON.stringify(entry.path) === JSON.stringify(fullPath),
    );
    if (existing)
      edits.push({
        start: existing.node.value.range[0],
        end: existing.node.value.range[1],
        text: JSON.stringify(value),
      });
    else missing.push({ path: fullPath, value });
  }
  if (missing.length) {
    const container = containers
      .filter(
        (entry) =>
          entry.path.length <= target.length &&
          entry.path.every((part, index) => part === target[index]),
      )
      .sort((left, right) => right.path.length - left.path.length)[0];
    const assignments = missing.map(
      (entry) =>
        `${entry.path
          .slice(container.path.length)
          .map((part) => JSON.stringify(part))
          .join(".")} = ${JSON.stringify(entry.value)}`,
    );
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    let offset;
    let text;
    if (container.node.type === "TOMLInlineTable") {
      offset = container.node.range[1] - 1;
      text = `${container.node.body.length ? ", " : " "}${assignments.join(", ")} `;
    } else if (container.node.type === "TOMLTable") {
      const lineEnd = source.indexOf("\n", container.node.key.range[1]);
      offset = lineEnd < 0 ? source.length : lineEnd + 1;
      text = `${lineEnd < 0 ? newline : ""}${assignments.join(newline)}${newline}`;
    } else {
      offset = 0;
      text = `${assignments.join(newline)}${newline}`;
    }
    edits.push({ start: offset, end: offset, text });
  }
  let next = source;
  for (const edit of edits.sort((left, right) => right.start - left.start))
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  parseConfig(next);
  return next;
}

/** Resolves the user config without reading credentials or host permissions. */
export function resolveCodexConfigPath(
  environment = process.env,
  home = os.homedir(),
) {
  if (environment.CODEX_HOME !== undefined && !environment.CODEX_HOME.trim())
    throw new Error("CODEX_HOME must be a non-empty directory when set.");
  return path.resolve(
    environment.CODEX_HOME ?? path.join(home, ".codex"),
    "config.toml",
  );
}
