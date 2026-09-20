/** Generate explicit per-name distribution coverage; prepared artifacts never count as secured names. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizeName } from "./audit-namespaces.mjs";

/** Join requested identities to channel-specific candidates and dated public observations. */
export function namespaceCoverage(inventory, observations) {
  const requested = inventory.requestedAliases;
  if (!Array.isArray(requested) || !requested.length || new Set(requested).size !== requested.length) throw new Error("Requested alias inventory is missing or duplicated");
  const channels = ["npm", "pypi", "ghcr", "mcp", "plugin", ...(inventory.unsupportedChannels ?? [])];
  const observed = new Map((observations?.entries ?? []).map(entry => [`${entry.registry}:${entry.name}`, entry]));
  const rows = [];
  for (const alias of requested) for (const channel of channels) {
    const candidates = inventory.entries.filter(entry => entry.registry === channel && (
      normalizeName(channel, entry.name) === normalizeName(channel, alias) ||
      (channel === "ghcr" || channel === "mcp") && entry.name.endsWith("/" + alias)
    ));
    const entries = candidates.map(entry => {
      const observation = observed.get(`${channel}:${entry.name}`);
      return {
        name: entry.name, role: entry.role, packagePath: entry.packagePath ?? null,
        publishIntent: entry.publishIntent === true,
        authorityVerified: entry.publicationControlVerified === true,
        namingEligibilityVerified: entry.namingEligibilityVerified === true,
        publicObservation: observation?.status ?? "not_checked",
        observedVersion: observation?.version ?? null,
        observedAt: observation?.fetchedAtUtc ?? null,
        reason: entry.reason ?? null,
      };
    });
    rows.push({ alias, channel, entries,
      disposition: !entries.length ? "not_implemented" : entries.some(entry => entry.role === "excluded_third_party") ? "excluded_third_party" : entries.some(entry => entry.role === "blocked_naming_rule") ? "blocked_naming_rule" : entries.some(entry => entry.publicObservation === "observed_project_link") ? (entries.some(entry => entry.publicObservation === "observed_project_link" && entry.authorityVerified) ? "published_metadata_observed_authority_verified" : "published_metadata_observed_authority_unproven") : "candidate_not_secured",
      scopedAlternatives: channel === "npm" ? inventory.entries.filter(entry => entry.registry === "npm" && entry.name.startsWith("@") && entry.name.endsWith("/" + alias)).map(entry => ({name: entry.name, role: entry.role, publishIntent: entry.publishIntent === true, authorityVerified: entry.publicationControlVerified === true, namingEligibilityVerified: entry.namingEligibilityVerified === true, reason: entry.reason ?? null})) : [],
    });
  }
  return {schemaVersion: 1, canonicalSource: inventory.canonicalSource, requestedAliases: requested, rows,
    limitation: "Public metadata and prepared packages do not establish publication authority, final-release deployment, or universal namespace protection."};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const read = name => JSON.parse(readFileSync(path.join(root, name), "utf8"));
  const result = namespaceCoverage(read("distribution/namespaces.json"), read("docs/reviews/platformio-namespace-observations.json"));
  const output = process.argv[2];
  if (!output) throw new Error("Provide an output JSON path");
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(`${result.requestedAliases.length} explicit names assessed across ${new Set(result.rows.map(row => row.channel)).size} channels; ${result.rows.filter(row => row.disposition === "not_implemented").length} channel/name pairs lack implementation.`);
}
