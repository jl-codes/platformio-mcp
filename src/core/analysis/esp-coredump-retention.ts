/** Private managed core-dump retention with a 24-hour lifetime and a 32-object storage bound. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import lockfile from "proper-lockfile";
import { SERVER_DATA_DIR } from "../../utils/paths.js";
import { PlatformIOError } from "../../utils/errors.js";
import { createPrivateAnalysisDirectory } from "./private-analysis-directory.js";
import { readPartitionArtifact } from "../esp-partition-artifacts.js";

const LIFETIME_MS = 24 * 60 * 60 * 1000;
const ROOT = path.join(SERVER_DATA_DIR, "artifacts", "coredumps");
const ENTRY = /^pio-private-analysis-[A-Za-z0-9]{6}$/;

async function withStore<T>(
  root: string,
  use: (canonical: string) => Promise<T>,
) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const state = await fs.lstat(root);
  if (!state.isDirectory() || state.isSymbolicLink())
    throw new PlatformIOError(
      "Invalid core-dump retention store.",
      "COREDUMP_STORE_INVALID",
    );
  const canonical = await fs.realpath(root);
  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(canonical, { stale: 120000, retries: 0 });
  } catch {
    throw new PlatformIOError(
      "Core-dump retention store is busy.",
      "COREDUMP_STORE_BUSY",
    );
  }
  try {
    return await use(canonical);
  } finally {
    await release();
  }
}

async function prune(root: string, now: number) {
  const entries = (await fs.readdir(root)).filter((name) => ENTRY.test(name));
  let retained = 0;
  for (const name of entries) {
    const directory = path.join(root, name);
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new PlatformIOError(
        "Invalid retained core-dump entry.",
        "COREDUMP_STORE_INVALID",
      );
    let expires: number;
    try {
      const metadata = await readPartitionArtifact(
        directory,
        "record.json",
        4096,
      );
      const record = JSON.parse(metadata.content.toString("utf8")) as {
        createdAt: number;
        expiresAt: number;
      };
      if (
        !Number.isSafeInteger(record.createdAt) ||
        !Number.isSafeInteger(record.expiresAt) ||
        record.expiresAt - record.createdAt !== LIFETIME_MS
      )
        throw new Error("Invalid retention interval");
      expires = record.expiresAt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new PlatformIOError(
          "Invalid core-dump retention record.",
          "COREDUMP_STORE_INVALID",
        );
      // A process may die between directory creation and metadata publication.
      expires = stat.birthtimeMs + LIFETIME_MS;
    }
    if (expires <= now)
      await fs.rm(directory, { recursive: true, force: true });
    else retained++;
  }
  return retained;
}

/** Remove expired managed entries; host-selected roots and time are test/integration dependencies, never request fields. */
export async function pruneRetainedEspCoredumps(root = ROOT, now = Date.now()) {
  return withStore(root, (canonical) => prune(canonical, now));
}

/** Retain exact partition bytes after export authorization; callers receive metadata, never memory content. */
export async function retainEspCoredump(
  input: Uint8Array,
  root = ROOT,
  now = Date.now(),
) {
  if (
    input.byteLength > 16 * 1024 * 1024 ||
    !Number.isSafeInteger(now) ||
    now < 0
  )
    throw new PlatformIOError(
      "Invalid core-dump retention input.",
      "COREDUMP_INPUT_LIMIT",
    );
  return withStore(root, async (canonical) => {
    if ((await prune(canonical, now)) >= 32)
      throw new PlatformIOError(
        "Core-dump retention has reached its 32-object limit.",
        "COREDUMP_STORE_FULL",
      );
    const directory = await createPrivateAnalysisDirectory(canonical);
    try {
      const bytes = Buffer.from(input);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const destination = path.join(directory, "dump.bin");
      const expiresAt = now + LIFETIME_MS;
      await fs.writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
      await fs.writeFile(
        path.join(directory, "record.json"),
        JSON.stringify({
          createdAt: now,
          expiresAt,
          size: bytes.length,
          sha256,
        }),
        { flag: "wx", mode: 0o600 },
      );
      const timer = setTimeout(() => {
        void pruneRetainedEspCoredumps(canonical).catch(() => {});
      }, LIFETIME_MS);
      timer.unref();
      return {
        path: destination,
        size: bytes.length,
        sha256,
        expiresAt,
        retention: "managed_24h" as const,
      };
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
  });
}

/** Sweep on server startup and once per minute; report cleanup failures and retry without overlapping sweeps. */
export async function startCoredumpRetentionCleanup(
  reportFailure: (code: string) => void,
  root = ROOT,
): Promise<() => Promise<void>> {
  let pending: Promise<void> | null = null;
  const sweep = () => {
    if (pending) return pending;
    pending = (async () => {
      try {
        try {
          await fs.access(root);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
          throw error;
        }
        await pruneRetainedEspCoredumps(root);
      } catch (error) {
        reportFailure(
          error instanceof PlatformIOError
            ? (error.code ?? "COREDUMP_CLEANUP_FAILED")
            : "COREDUMP_CLEANUP_FAILED",
        );
      }
    })().finally(() => {
      pending = null;
    });
    return pending;
  };
  await sweep();
  const timer = setInterval(() => {
    void sweep();
  }, 60000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await pending;
  };
}
