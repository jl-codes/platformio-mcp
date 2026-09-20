#!/usr/bin/env node
/** Assemble existing same-revision evidence packets without manufacturing results or relaxing release gates. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateAcceptance } from "./validate-parity-acceptance.mjs";

function readManifest(file) {
  if (fs.statSync(file).size > 8 * 1024 * 1024) throw new Error("Acceptance manifest exceeds 8 MiB");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Copy only hash-verified contained artifacts, preserving all assertions and observed outcomes verbatim. */
export function collectAcceptance(packetDirectories, destination, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit) || !Array.isArray(packetDirectories) || !packetDirectories.length || packetDirectories.length > 256)
    throw new Error("Specify a full commit and 1–256 existing evidence packets");
  const output = path.resolve(destination);
  if (fs.existsSync(output)) throw new Error("Acceptance destination already exists; never replace evidence");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(output), ".acceptance-collect-"));
  const entries = [];
  const seen = new Set();
  try {
    for (const [index, source] of packetDirectories.entries()) {
      const directory = fs.realpathSync(source);
      const manifest = readManifest(path.join(directory, "manifest.json"));
      if (manifest.schemaVersion !== 1 || manifest.sourceCommit !== commit || !Array.isArray(manifest.entries))
        throw new Error("Every packet must identify the exact requested source revision");
      const copied = new Map();
      const copyArtifact = (item) => {
        if (!item || typeof item.path !== "string" || path.isAbsolute(item.path) || !/^[a-f0-9]{64}$/.test(item.sha256 ?? ""))
          throw new Error("Invalid source artifact identity");
        const actual = fs.realpathSync(path.resolve(directory, item.path));
        const relative = path.relative(directory, actual);
        if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) || !fs.statSync(actual).isFile())
          throw new Error("Source evidence escapes its packet");
        if (fs.statSync(actual).size > 256 * 1024 * 1024) throw new Error("Evidence artifact exceeds 256 MiB");
        const bytes = fs.readFileSync(actual);
        if (createHash("sha256").update(bytes).digest("hex") !== item.sha256) throw new Error("Source artifact hash mismatch");
        const key = actual + ":" + item.sha256;
        let target = copied.get(key);
        if (!target) {
          target = `packets/${index}/${copied.size}-${item.sha256}`;
          const file = path.join(temporary, target);
          fs.mkdirSync(path.dirname(file), {recursive: true});
          fs.writeFileSync(file, bytes, {flag: "wx"});
          copied.set(key, target);
        }
        return {...item, path: target};
      };
      for (const entry of manifest.entries) {
        if (!entry || typeof entry.requirementId !== "string" || seen.has(entry.requirementId))
          throw new Error("Duplicate or missing requirement; resolve competing evidence explicitly");
        seen.add(entry.requirementId);
        if (!Array.isArray(entry.artifacts)) throw new Error("Supporting artifacts are missing");
        entries.push({...entry, evidence: copyArtifact(entry.evidence), artifacts: entry.artifacts.map(copyArtifact)});
      }
    }
    const manifest = {schemaVersion: 1, sourceCommit: commit, entries};
    const result = validateAcceptance(manifest, temporary, commit);
    fs.writeFileSync(path.join(temporary, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {flag: "wx"});
    // Recheck before publication; the directory is never visible as a passing packet until validation succeeds.
    if (fs.existsSync(output)) throw new Error("Acceptance destination was created concurrently");
    fs.renameSync(temporary, output);
    return {...result, packetDirectory: output};
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, {recursive: true, force: true});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [destination, ...packets] = process.argv.slice(2);
  if (!destination || !packets.length) throw new Error("Usage: collect-parity-acceptance.mjs <new-output-directory> <packet-directory> [...]");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8"}).trim();
  console.log(JSON.stringify(collectAcceptance(packets, destination, commit)));
}
