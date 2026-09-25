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
/** Compare ownership-relevant public observations without timestamp or response formatting noise. */
export function namespaceChanges(previous, current) {
  const old = new Map((previous?.entries ?? []).map(entry => [`${entry.registry}:${entry.name}`, entry]));
  const fields = ["status", "version", "repository", "maintainers", "integrity"];
  return current.entries.flatMap(entry => {
    const before = old.get(`${entry.registry}:${entry.name}`);
    const changed = fields.filter(field => JSON.stringify(before?.[field] ?? null) !== JSON.stringify(entry[field] ?? null));
    return changed.length ? [{registry:entry.registry,name:entry.name,changed,before:before?.status ?? null,after:entry.status}] : [];
  });
}
export async function audit(inventory, fetcher = fetch, previous = null) {
  if (!Array.isArray(inventory.entries) || inventory.entries.length > 100 || !Number.isInteger(inventory.maxLookups) || inventory.maxLookups < 1 || inventory.maxLookups > 100) throw new Error("Namespace audit requires an integer lookup limit between 1 and 100");
  const now = Date.now();
  let lookups = 0;
  const cached = new Map((previous?.canonicalSource === inventory.canonicalSource ? previous.entries ?? [] : []).map(entry => [`${entry.registry}:${entry.name}`, entry]));
  const entries = [];
  for (const entry of inventory.entries) {
    const normalizedName = normalizeName(entry.registry, entry.name);
    const sourceUrl = entry.registry === "npm" ? `https://registry.npmjs.org/${encodeURIComponent(entry.name)}/latest` : entry.registry === "pypi" ? `https://pypi.org/pypi/${encodeURIComponent(normalizedName)}/json` : null;
    const result = {...entry, normalizedName, sourceUrl, fetchedAtUtc: new Date().toISOString(), publicationControlVerified: false};
    if (!sourceUrl) {entries.push({...result, status: "unknown", reason: "Requires channel-specific authority and installation verification"}); continue;}
    const prior = cached.get(`${entry.registry}:${entry.name}`);
    const observed = Date.parse(prior?.fetchedAtUtc ?? "");
    const eligible = Date.parse(prior?.nextLookupAtUtc ?? "");
    if (prior?.sourceUrl === sourceUrl && observed <= now && eligible > now && eligible <= now + 86400000) {
      entries.push({...prior,...entry,publicationControlVerified:false,cached:true});
      continue;
    }
    if (lookups >= inventory.maxLookups) {
      entries.push({...result,status:"unknown",reason:"Configured registry lookup budget exhausted"});
      continue;
    }
    lookups++;
    try {
      const response = await fetcher(sourceUrl, {signal: AbortSignal.timeout(15000), redirect: "error"});
      const retry = response.headers?.get("retry-after");
      const retryMilliseconds = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry ?? "") - now);
      const delay = response.status === 429 ? Math.min(86400000, Math.max(60000, retryMilliseconds || 3600000)) : response.status === 200 || response.status === 404 ? 21600000 : 3600000;
      result.nextLookupAtUtc = new Date(now + delay).toISOString();
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
    } catch (error) {entries.push({...result, nextLookupAtUtc:new Date(now+3600000).toISOString(), status: "unknown", reason: error instanceof Error ? error.message : "Lookup failed"});}
  }
  return {schemaVersion: 1, canonicalSource:inventory.canonicalSource, lookups, method: "Read-only public metadata; no installation or publication. Missing lookup is not a reservation or proof of availability.", entries};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inventory = JSON.parse(readFileSync(new URL("../distribution/namespaces.json", import.meta.url), "utf8"));
  const output = process.argv[2];
  if (!output) throw new Error("Provide an output JSON path");
  let previous = null;
  try { previous = JSON.parse(readFileSync(output,"utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const result = await audit(inventory, fetch, previous);
  result.changes = namespaceChanges(previous, result);
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result.entries.map(({registry, name, status, version}) => ({registry, name, status, version})), null, 2));
}
