/** Bounded installed-library collection from explicitly authorized directory roots. */
import fs from "node:fs/promises";
import path from "node:path";
import type { DependencyLibrary } from "./dependency-audit.js";
import { parseDependencyManifest } from "./dependency-manifest.js";
import { PlatformIOError } from "../utils/errors.js";

/** A root approved by the caller's policy boundary; collection itself grants no filesystem authority. */
export interface DependencyInventoryRoot {
  directory: string;
  source: DependencyLibrary["source"];
}
/** Incomplete evidence is separate from findings and prevents a clean audit claim. */
export interface DependencyInventoryDiagnostic {
  path: string;
  code: string;
}
/** Scan one directory level per approved root; never silently follow library or manifest links. */
export async function collectDependencyInventory(
  roots: readonly DependencyInventoryRoot[],
) {
  if (roots.length > 64)
    throw new PlatformIOError("Too many library roots.", "DEPENDENCY_LIMIT");
  const libraries: DependencyLibrary[] = [];
  const diagnostics: DependencyInventoryDiagnostic[] = [];
  let entries = 0,
    bytes = 0;
  const seenRoots = new Set<string>();
  for (const root of roots) {
    const directory = path.resolve(root.directory);
    let canonical: string;
    try {
      canonical = await fs.realpath(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      diagnostics.push({ path: directory, code: "ROOT_UNREADABLE" });
      continue;
    }
    if (seenRoots.has(canonical)) continue;
    seenRoots.add(canonical);
    let handle;
    try {
      handle = await fs.opendir(canonical);
    } catch {
      diagnostics.push({ path: directory, code: "ROOT_UNREADABLE" });
      continue;
    }
    for await (const entry of handle) {
      if (++entries > 4096)
        throw new PlatformIOError(
          "Library inventory exceeds 4096 entries.",
          "DEPENDENCY_LIMIT",
        );
      if (entry.name.startsWith(".")) continue;
      const libraryPath = path.join(canonical, entry.name);
      if (entry.isSymbolicLink()) {
        diagnostics.push({
          path: libraryPath,
          code: "LIBRARY_LINK_NOT_SCANNED",
        });
        continue;
      }
      if (!entry.isDirectory()) continue;
      if (libraries.length >= 2048)
        throw new PlatformIOError(
          "Library inventory exceeds 2048 libraries.",
          "DEPENDENCY_LIMIT",
        );
      let manifest: ReturnType<typeof parseDependencyManifest> | undefined;
      for (const [filename, format] of [
        ["library.json", "json"],
        ["library.properties", "properties"],
      ] as const) {
        const manifestPath = path.join(libraryPath, filename);
        let info;
        try {
          info = await fs.lstat(manifestPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          diagnostics.push({ path: manifestPath, code: "MANIFEST_UNREADABLE" });
          break;
        }
        if (!info.isFile() || info.isSymbolicLink()) {
          diagnostics.push({
            path: manifestPath,
            code: "MANIFEST_NOT_REGULAR",
          });
          break;
        }
        if (info.size > 1024 * 1024 || bytes + info.size > 16 * 1024 * 1024)
          throw new PlatformIOError(
            "Library manifest byte budget exceeded.",
            "DEPENDENCY_LIMIT",
          );
        try {
          const file = await fs.open(manifestPath, "r");
          try {
            const opened = await file.stat();
            if (
              !opened.isFile() ||
              opened.dev !== info.dev ||
              opened.ino !== info.ino
            )
              throw new Error("Manifest changed");
            const buffer = Buffer.alloc(1024 * 1024 + 1);
            let used = 0;
            while (used < buffer.length) {
              const read = await file.read(
                buffer,
                used,
                buffer.length - used,
                null,
              );
              if (!read.bytesRead) break;
              used += read.bytesRead;
            }
            bytes += used;
            if (used > 1024 * 1024 || bytes > 16 * 1024 * 1024)
              throw new PlatformIOError(
                "Library manifest byte budget exceeded.",
                "DEPENDENCY_LIMIT",
              );
            manifest = parseDependencyManifest(
              buffer.subarray(0, used).toString("utf8"),
              format,
            );
          } finally {
            await file.close();
          }
        } catch (error) {
          if (
            error instanceof PlatformIOError &&
            error.code === "DEPENDENCY_LIMIT"
          )
            throw error;
          diagnostics.push({
            path: manifestPath,
            code:
              error instanceof PlatformIOError
                ? (error.code ?? "MANIFEST_UNREADABLE")
                : "MANIFEST_UNREADABLE",
          });
        }
        break; // A malformed preferred JSON manifest must not silently fall back.
      }
      if (!manifest)
        diagnostics.push({
          path: libraryPath,
          code: "MANIFEST_EVIDENCE_MISSING",
        });
      libraries.push({
        name: manifest?.name ?? entry.name,
        directoryName: entry.name,
        path: libraryPath,
        source: root.source,
        version: manifest?.version ?? null,
        dependencies: manifest?.dependencies ?? [],
      });
    }
  }
  return {
    libraries,
    diagnostics,
    complete: diagnostics.length === 0,
    manifestBytes: bytes,
  };
}
