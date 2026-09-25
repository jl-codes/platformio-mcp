/** Synchronize every functional npm alias with the canonical version without enabling publication. */
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const canonical = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const inventory = JSON.parse(readFileSync(path.join(root, "distribution/namespaces.json"), "utf8"));
const check = process.argv.includes("--check");
if (process.argv.slice(2).some(arg => arg !== "--check")) throw new Error("Only --check is supported");
const changes = [];
const seen = new Set();
// Validate the complete edit set before writing anything. Registry authority flags are never changed.
for (const entry of inventory.entries) {
  if (entry.registry !== "npm" || entry.name === canonical.name || !entry.packagePath) continue;
  if (entry.role === "blocked_naming_rule" && entry.publishIntent !== false) throw new Error("Blocked npm alias cannot enable publication");
  if (!["functional_alias", "candidate_alias", "blocked_naming_rule"].includes(entry.role) || entry.source !== inventory.canonicalSource || seen.has(entry.name)) throw new Error("Invalid npm alias inventory");
  seen.add(entry.name);
  const directory = realpathSync(path.resolve(root, entry.packagePath));
  const relative = path.relative(path.join(root, "packages"), directory);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("Alias directory escapes packages");
  const filename = realpathSync(path.join(directory, "package.json"));
  if (path.dirname(filename) !== directory) throw new Error("Alias manifest escapes its directory");
  const manifest = JSON.parse(readFileSync(filename, "utf8"));
  if (manifest.name !== entry.name || manifest.scripts || Object.keys(manifest.dependencies ?? {}).join() !== canonical.name) throw new Error("Alias must delegate only to the canonical engine");
  if (manifest.version !== canonical.version || manifest.dependencies[canonical.name] !== canonical.version) {
    manifest.version = canonical.version;
    manifest.dependencies[canonical.name] = canonical.version;
    changes.push({ filename, manifest });
  }
}
if (check && changes.length) throw new Error(`${changes.length} npm alias version(s) differ; run npm run aliases:sync`);
for (const { filename, manifest } of changes) writeFileSync(filename, JSON.stringify(manifest, null, 2) + "\n");
console.log(`${seen.size} functional npm aliases ${check ? "checked" : "synchronized"} at ${canonical.version}`);
