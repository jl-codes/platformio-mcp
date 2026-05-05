/**
 * Installer for OpenAI Codex CLI.
 *
 * Codex CLI reads MCP server definitions from a TOML file in the user's home
 * directory:
 *   macOS / Linux: ~/.codex/config.toml
 *   Windows:       %USERPROFILE%\.codex\config.toml
 *
 * The TOML schema for an MCP STDIO server is:
 *
 *   [mcp_servers.<name>]
 *   command = "npx"
 *   args = ["-y", "platformio-mcp", "--open-dashboard-on-start"]
 *
 * Because Codex's config.toml is shared with other settings (model, sandbox,
 * approvals, etc.), we cannot simply rewrite the whole file. Instead, this
 * installer performs a surgical, idempotent merge:
 *
 *   1. Locate the `[mcp_servers.platformio]` block (and any contiguous
 *      sub-tables like `[mcp_servers.platformio.env]`).
 *   2. Replace it in-place if found, or append it to the end of the file.
 *   3. Preserve every other section verbatim.
 *
 * If the existing file fails our minimal validity check, it is backed up to
 * `<file>.bak` and rewritten with just our block.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const BLOCK_KEY = "platformio";

/**
 * Renders the canonical TOML block for our MCP server entry. Uses `npx.cmd` on
 * Windows for the same reason as `_shared.js`: some hosts cannot resolve a
 * bare `npx` on Windows without the extension.
 *
 * @returns {string} TOML text terminated with a single trailing newline.
 */
function renderTomlBlock() {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  return [
    `[mcp_servers.${BLOCK_KEY}]`,
    `command = "${command}"`,
    `args = ["-y", "platformio-mcp", "--open-dashboard-on-start"]`,
    "",
  ].join("\n");
}

/**
 * Locates the byte range of an existing `[mcp_servers.<BLOCK_KEY>]` block in
 * the given TOML source. The range extends from the header line through (but
 * not including) the next top-level `[...]` header that is *not* a sub-table
 * of our block (e.g. `[mcp_servers.platformio.env]` is part of our block).
 *
 * @param {string} source Raw TOML file contents.
 * @returns {{ start: number, end: number } | null} Byte offsets, or null if absent.
 */
function findBlockRange(source) {
  const headerRegex = new RegExp(
    `^[ \\t]*\\[\\s*mcp_servers\\.${BLOCK_KEY}\\s*\\]`,
    "m",
  );
  const headerMatch = source.match(headerRegex);
  if (!headerMatch || headerMatch.index === undefined) {
    return null;
  }

  const start = headerMatch.index;
  const subTablePrefix = `[mcp_servers.${BLOCK_KEY}.`;
  const ourTableHeader = `[mcp_servers.${BLOCK_KEY}]`;

  // Walk forward line-by-line from the line *after* the header until we find
  // the next top-level table header that does not belong to us.
  let cursor = source.indexOf("\n", start);
  if (cursor === -1) {
    return { start, end: source.length };
  }
  cursor += 1; // move past the newline

  while (cursor < source.length) {
    const lineEnd = source.indexOf("\n", cursor);
    const line = source.slice(cursor, lineEnd === -1 ? source.length : lineEnd);
    const trimmed = line.trim();

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      // Sub-tables of our block stay inside the range.
      const isOurSubTable =
        trimmed.startsWith(subTablePrefix) || trimmed === ourTableHeader;
      if (!isOurSubTable) {
        return { start, end: cursor };
      }
    }

    if (lineEnd === -1) break;
    cursor = lineEnd + 1;
  }

  return { start, end: source.length };
}

/**
 * Idempotently writes the platformio MCP server entry into Codex's
 * config.toml. Creates parent directories as needed.
 *
 * @param {string} configPath Absolute path to config.toml.
 * @returns {{ path: string, action: "created" | "updated" }}
 */
function mergeCodexConfig(configPath) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const block = renderTomlBlock();

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, block);
    return { path: configPath, action: "created" };
  }

  let existing = fs.readFileSync(configPath, "utf8");

  // Minimal sanity check: TOML is line-oriented; if the file contains a NUL
  // byte it's almost certainly binary garbage. Back up and rewrite.
  if (existing.indexOf("\0") !== -1) {
    console.warn(
      `[WARN] Existing config at ${configPath} appears corrupt; backing up to .bak and rewriting.`,
    );
    fs.copyFileSync(configPath, `${configPath}.bak`);
    fs.writeFileSync(configPath, block);
    return { path: configPath, action: "updated" };
  }

  const range = findBlockRange(existing);
  let next;

  if (range) {
    // Replace in place, ensuring exactly one blank line separates our block
    // from neighboring content on either side.
    const before = existing.slice(0, range.start).replace(/\s+$/, "");
    const after = existing.slice(range.end).replace(/^\s+/, "");
    const head = before.length > 0 ? before + "\n\n" : "";
    const tail = after.length > 0 ? "\n" + after : "";
    next = head + block + tail;
  } else {
    // Append, separated by exactly one blank line.
    const trimmed = existing.replace(/\s+$/, "");
    next = trimmed.length > 0 ? trimmed + "\n\n" + block : block;
  }

  // Guarantee a trailing newline on the file.
  if (!next.endsWith("\n")) next += "\n";

  fs.writeFileSync(configPath, next);
  return { path: configPath, action: "updated" };
}

export async function installCodex() {
  const target = path.join(os.homedir(), ".codex", "config.toml");
  const r = mergeCodexConfig(target);
  console.log(`✅ Codex CLI config ${r.action} at: ${r.path}`);
  console.log(
    `\nNext: restart Codex (\`codex\`) and run \`/mcp\` to confirm the platformio server is listed. The dashboard auto-opens on first MCP boot.`,
  );
}

// Exported for unit testing.
export { findBlockRange, renderTomlBlock, mergeCodexConfig };
