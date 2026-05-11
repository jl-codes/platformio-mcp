/**
 * Build Cache Utility
 *
 * Content-hash–based short-circuit for `pio run`. EmbedBench traces showed
 * agents repeatedly rebuilding identical firmware across hill-climbing
 * iterations (same `src/*` contents, same `platformio.ini`, k=1..k=5) and
 * paying 30–120 s of wall + agent overhead for no toolchain work.
 *
 * Strategy:
 *   1. Hash a deterministic projection of inputs that *should* invalidate a
 *      cached build: every regular file under `src/`, `include/`, `lib/`, plus
 *      `platformio.ini`. Each file contributes `path|size|sha256(content)`.
 *   2. Combine with the requested `environment` (or "default") and a schema
 *      version tag so changes to this module bust prior caches.
 *   3. Persist the cache as `<projectDir>/.pio/.mcp-build-cache.json` — the
 *      `.pio/` directory is already gitignored by PlatformIO convention.
 *   4. On a hit, verify the recorded firmware artifact (if any) still exists
 *      on disk; otherwise treat as miss so we don't lie to upload tools.
 *
 * Intentionally simple: no LRU, no multi-entry cache, no mtime fast path
 * before hash. Content-only hashing is robust against editor "touch" without
 * change and against partial rebuilds. The miss cost (one full `pio run`) is
 * the same as today, so the worst case is unchanged.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** Bump when this module's hash/structure semantics change. */
const CACHE_SCHEMA = "v1";

/** Persisted shape on disk. Keep additive — old fields must remain readable. */
export interface BuildCacheEntry {
  schema: string;
  /** Hash of all project inputs (see {@link computeProjectHash}). */
  inputsHash: string;
  /** Specific environment built (or `"default"`). */
  environment: string;
  /** UNIX epoch milliseconds of when this entry was recorded. */
  builtAtMs: number;
  /** Optional absolute path to the firmware artifact verified on cache hits. */
  firmwarePath?: string;
  /** RAM bytes parsed from the original build log (for replay). */
  ramUsageBytes?: number;
  /** Flash bytes parsed from the original build log (for replay). */
  flashUsageBytes?: number;
  /** Tail of build log we replay on cache hits. */
  finalOutputTail?: string;
}

/** Hashable file entry contributing to the project input fingerprint. */
interface HashedFile {
  rel: string;
  size: number;
  sha256: string;
}

/** Directory names whose contents participate in the cache key. */
const TRACKED_DIRS = ["src", "include", "lib"] as const;

/** Files at the project root that participate in the cache key. */
const TRACKED_FILES = ["platformio.ini"] as const;

/**
 * Hashes a single file's bytes with SHA-256, returning hex.
 * Files we can't read (permissions, races) are skipped — caller treats this
 * as a miss because a broken-read file is not safely cacheable.
 */
function hashFile(absPath: string): { sha256: string; size: number } | null {
  try {
    const buf = fs.readFileSync(absPath);
    return {
      sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      size: buf.byteLength,
    };
  } catch {
    return null;
  }
}

/**
 * Recursively walks a directory and returns hashes of every regular file.
 * Symlinks are not followed (they're ambient-state risks for caching).
 */
function walkAndHash(rootDir: string, relPrefix: string): HashedFile[] {
  const out: HashedFile[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const absPath = path.join(rootDir, entry.name);
    const relPath = path.posix.join(relPrefix, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkAndHash(absPath, relPath));
    } else if (entry.isFile()) {
      const h = hashFile(absPath);
      if (h) out.push({ rel: relPath, size: h.size, sha256: h.sha256 });
    }
    // Symlinks, sockets, etc. intentionally ignored.
  }
  return out;
}

/**
 * Computes the content fingerprint for a project directory. Pure function over
 * disk state — same project → same hash, regardless of mtime drift.
 *
 * @param projectDir - Absolute path to the PlatformIO project root.
 * @param environment - Environment name (or "default"); included in the hash.
 * @returns Lowercase hex SHA-256 digest. Empty projects still produce a
 *   stable digest so first-build wiring is deterministic.
 */
export function computeProjectHash(
  projectDir: string,
  environment: string,
): string {
  const components: string[] = [`schema:${CACHE_SCHEMA}`, `env:${environment}`];

  for (const file of TRACKED_FILES) {
    const abs = path.join(projectDir, file);
    const h = hashFile(abs);
    if (h) components.push(`${file}|${h.size}|${h.sha256}`);
    else components.push(`${file}|missing`);
  }

  const collected: HashedFile[] = [];
  for (const dir of TRACKED_DIRS) {
    const abs = path.join(projectDir, dir);
    if (fs.existsSync(abs)) collected.push(...walkAndHash(abs, dir));
  }
  // Sort for determinism — readdir order is not guaranteed cross-platform.
  collected.sort((a, b) => a.rel.localeCompare(b.rel));
  for (const f of collected) {
    components.push(`${f.rel}|${f.size}|${f.sha256}`);
  }

  return crypto
    .createHash("sha256")
    .update(components.join("\n"))
    .digest("hex");
}

/**
 * Returns the cache file path for a project. Created lazily on writes; reads
 * tolerate missing/corrupt files by returning `null` (always a miss).
 */
export function cacheFilePath(projectDir: string): string {
  return path.join(projectDir, ".pio", ".mcp-build-cache.json");
}

/**
 * Reads the persisted cache entry for a project, validating the schema tag.
 * Returns `null` on any of: missing file, JSON parse error, schema mismatch.
 */
export function readCache(projectDir: string): BuildCacheEntry | null {
  const file = cacheFilePath(projectDir);
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as BuildCacheEntry;
    if (!parsed || parsed.schema !== CACHE_SCHEMA) return null;
    if (typeof parsed.inputsHash !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Writes a cache entry to disk, ensuring the `.pio/` parent exists. Failures
 * are swallowed because cache writes are best-effort — a missed cache write
 * just means the next call is a (correct) cache miss.
 */
export function writeCache(
  projectDir: string,
  entry: Omit<BuildCacheEntry, "schema">,
): void {
  try {
    const file = cacheFilePath(projectDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const full: BuildCacheEntry = { schema: CACHE_SCHEMA, ...entry };
    fs.writeFileSync(file, JSON.stringify(full, null, 2));
  } catch {
    // Best effort; silent.
  }
}

/**
 * Looks up a cache entry for the project + environment and reports whether
 * it's a usable hit. A hit requires the inputs hash, environment match, *and*
 * (when recorded) the firmware artifact still existing on disk.
 *
 * @returns `{ hit: true, entry }` if usable, otherwise `{ hit: false }`.
 */
export function lookupBuildCache(
  projectDir: string,
  environment: string,
): { hit: true; entry: BuildCacheEntry; inputsHash: string } | { hit: false; inputsHash: string } {
  const inputsHash = computeProjectHash(projectDir, environment);
  const entry = readCache(projectDir);
  if (!entry) return { hit: false, inputsHash };
  if (entry.environment !== environment) return { hit: false, inputsHash };
  if (entry.inputsHash !== inputsHash) return { hit: false, inputsHash };
  if (entry.firmwarePath && !fs.existsSync(entry.firmwarePath)) {
    // Firmware was deleted (e.g. by clean_project) — treat as miss so the
    // upload tools can't pick up a stale "successful" cache.
    return { hit: false, inputsHash };
  }
  return { hit: true, entry, inputsHash };
}

/**
 * Heuristically locates the most recently modified firmware artifact under
 * `.pio/build/<environment>/`. PIO writes `firmware.bin`, `firmware.elf`,
 * `firmware.hex`, or `program` depending on the platform. Returns `undefined`
 * when nothing exists — that's fine, callers downgrade to a no-artifact
 * cache entry which still saves the toolchain reinvocation.
 */
export function findFirmwareArtifact(
  projectDir: string,
  environment: string,
): string | undefined {
  const buildDir = path.join(projectDir, ".pio", "build", environment);
  if (!fs.existsSync(buildDir)) return undefined;
  const candidates = ["firmware.bin", "firmware.elf", "firmware.hex", "program"];
  let best: { path: string; mtimeMs: number } | undefined;
  for (const name of candidates) {
    const p = path.join(buildDir, name);
    try {
      const st = fs.statSync(p);
      if (!best || st.mtimeMs > best.mtimeMs) {
        best = { path: p, mtimeMs: st.mtimeMs };
      }
    } catch {
      /* skip */
    }
  }
  return best?.path;
}

/**
 * Invalidates the cache by removing the persisted entry. Safe to call when
 * no cache exists. Intended for `clean_project` and for explicit overrides.
 */
export function invalidateBuildCache(projectDir: string): void {
  try {
    fs.unlinkSync(cacheFilePath(projectDir));
  } catch {
    /* not present is fine */
  }
}
