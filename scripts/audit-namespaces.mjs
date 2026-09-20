#!/usr/bin/env node
/** Read-only bounded namespace audit; public metadata never proves publishing authority. */
import {readFileSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import path from "node:path";
export function normalizeName(registry, name) {
  return registry === "pypi" ? name.toLowerCase().replace(/[-_.]+/g, "-") : name;
}
export function classify(entry, status, metadata, canonicalSource) {
  if (status === 404) return "lookup_missing";
  if (status === 401 || status === 403 || status === 429) return "registry_blocked";
  if (status !== 200) return "unknown";
  const source = entry.registry === "npm" ? (typeof metadata.repository === "string" ? metadata.repository : metadata.repository?.url) : Object.values(metadata.info?.project_urls ?? {}).find(value => String(value).includes("github.com/"));
  const clean = String(source ?? "").replace(/^git\+/, "").replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
  return clean === canonicalSource.toLowerCase() ? "observed_project_link" : source ? "third_party" : "unknown";
}
export async function audit(inventory, fetcher = fetch) {
  if (!Array.isArray(inventory.entries) || inventory.entries.length > 100 || inventory.maxLookups > 100) throw new Error("Namespace audit exceeds 100-entry limit");
  const entries = [];
  for (const entry of inventory.entries) {
    const normalizedName = normalizeName(entry.registry, entry.name);
    const sourceUrl = entry.registry === "npm" ? `https://registry.npmjs.org/${encodeURIComponent(entry.name)}/latest` : entry.registry === "pypi" ? `https://pypi.org/pypi/${encodeURIComponent(normalizedName)}/json` : null;
    const result = {...entry, normalizedName, sourceUrl, fetchedAtUtc: new Date().toISOString(), publicationControlVerified: false};
    if (!sourceUrl) {entries.push({...result, status: "unknown", reason: "Requires channel-specific authority and installation verification"}); continue;}
    try {
      const response = await fetcher(sourceUrl, {signal: AbortSignal.timeout(15000), redirect: "error"});
      const chunks = []; let size = 0;
      if (response.body) for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 2 * 1024 * 1024) throw new Error("Registry response exceeds limit");
        chunks.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks);
      const text = raw.toString("utf8");
      const metadata = response.status === 200 ? JSON.parse(text) : {};
      entries.push({...result, httpStatus: response.status, status: classify(entry, response.status, metadata, inventory.canonicalSource), responseSha256: createHash("sha256").update(raw).digest("hex"), version: metadata.version ?? metadata.info?.version ?? null, repository: metadata.repository ?? metadata.info?.project_urls ?? null, maintainers: (metadata.maintainers ?? []).map(item => item.name), integrity: metadata.dist?.integrity ?? null});
    } catch (error) {entries.push({...result, status: "unknown", reason: error instanceof Error ? error.message : "Lookup failed"});}
  }
  return {schemaVersion: 1, method: "Read-only public metadata; no installation or publication. Missing lookup is not a reservation or proof of availability.", entries};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inventory = JSON.parse(readFileSync(new URL("../distribution/namespaces.json", import.meta.url), "utf8"));
  const result = await audit(inventory);
  const output = process.argv[2];
  if (!output) throw new Error("Provide an output JSON path");
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result.entries.map(({registry, name, status, version}) => ({registry, name, status, version})), null, 2));
}
