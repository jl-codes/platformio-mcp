#!/usr/bin/env node
/** Reject incomplete, stale, skipped or altered acceptance packets before any release publication. */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = file => JSON.parse(readFileSync(file, "utf8"));
const requirements = read(path.join(root, "docs/reviews/platformio-acceptance-requirements.json"));
const baseline = read(path.join(root, "docs/reviews/platformio-parity-baseline.json"));
const legacy = read(path.join(root, "docs/reviews/platformio-product-contracts.json"));
const ids = new Set(requirements.requirements.map(item => item.id));
if (ids.size !== requirements.requirements.length || baseline.tools.length !== 40 || baseline.tools.some(item => !ids.has(item.requirementId)) || legacy.tools.some((_item, index) => !ids.has(`LEG-${String(index + 1).padStart(2, "0")}`))) throw new Error("Acceptance catalog omits pinned parity or legacy requirements");


/** Validate evidence against the full required inventory, never against only the supplied passing subset. */
export function validateAcceptance(manifest, packetRoot, commit) {
  if (manifest.schemaVersion !== 1 || manifest.sourceCommit !== commit) throw new Error("Acceptance packet must match the exact release commit");
  if (!Array.isArray(manifest.entries)) throw new Error("Acceptance entries are missing");
  const entries = new Map(manifest.entries.map(entry => [entry.requirementId, entry]));
  if (entries.size !== manifest.entries.length || entries.size !== requirements.requirements.length) throw new Error("Acceptance requirement inventory is incomplete or duplicated");
  const directory = realpathSync(packetRoot);
  const artifact = item => {
    if (!item || typeof item.path !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256 ?? "") || path.isAbsolute(item.path)) throw new Error("Invalid evidence artifact identity");
    const resolved = realpathSync(path.resolve(directory, item.path));
    const relative = path.relative(directory, resolved);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) || !statSync(resolved).isFile()) throw new Error("Evidence artifact escapes packet");
    if (createHash("sha256").update(readFileSync(resolved)).digest("hex") !== item.sha256) throw new Error("Evidence artifact hash mismatch");
    return resolved;
  };
  for (const requirement of requirements.requirements) {
    const entry = entries.get(requirement.id);
    if (!entry || entry.implementationStatus !== "complete" || entry.outcome !== "pass" || entry.expectedAssertion !== requirement.assertion) throw new Error(`Incomplete acceptance: ${requirement.id}`);
    for (const field of ["procedure", "executor", "environment", "timestamp"]) if (typeof entry[field] !== "string" || !entry[field].trim()) throw new Error(`Missing ${field}: ${requirement.id}`);
    const timestamp = Date.parse(entry.timestamp);
    if (!Number.isFinite(timestamp) || timestamp > Date.now() + 60000) throw new Error(`Invalid evidence timestamp: ${requirement.id}`);
    if (!Array.isArray(entry.artifacts) || !entry.artifacts.length) throw new Error(`Missing supporting artifacts: ${requirement.id}`);
    for (const item of entry.artifacts) artifact(item);
    const evidence = read(artifact(entry.evidence));
    if (evidence.sourceCommit !== commit || evidence.outcome !== "pass" || evidence.kind !== requirement.kind || !evidence.requirements?.includes(requirement.id) || !evidence.assertions?.includes(requirement.assertion)) throw new Error(`Evidence does not establish required scope: ${requirement.id}`);
    if (evidence.skipped !== 0 || evidence.failed !== 0 || !Number.isSafeInteger(evidence.passed) || evidence.passed < 1) throw new Error(`Skipped, failed or absent evidence: ${requirement.id}`);
  }
  return { sourceCommit: commit, requirements: entries.size, outcome: "pass" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifestPath = path.resolve(process.argv[2] ?? path.join(root, "docs/reviews/platformio-parity-acceptance.json"));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8"}).trim();
  console.log(JSON.stringify(validateAcceptance(read(manifestPath), path.dirname(manifestPath), commit)));
}
