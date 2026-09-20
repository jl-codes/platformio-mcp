#!/usr/bin/env node
/** Verify exact release identities before any publication; reject silent reuse of unrelated existing versions. */
import {readFileSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {npmReleasePackages} from "./npm-release-packages.mjs";
export function assessPublishedArtifact(status, metadata, expected) {
  if (status === 404) return "unpublished";
  if (status !== 200) throw new Error(`Cannot verify ${expected.name}: registry returned ${status}`);
  if (metadata.name !== expected.name || metadata.version !== expected.version || metadata.dist?.integrity !== expected.integrity)
    throw new Error(`Published artifact differs from this release: ${expected.name}@${expected.version}; select a new release version`);
  return "identical";
}
export async function planNpmRelease(root, artifacts, fetcher = fetch) {
  const entries = [];
  for (const manifest of npmReleasePackages(root)) {
    const name = manifest.name;
    const file = path.resolve(artifacts, manifest.filename);
    const integrity = "sha512-" + createHash("sha512").update(readFileSync(file)).digest("base64");
    const expected = {name, version: manifest.version, integrity, file};
    const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(manifest.version)}`, {signal: AbortSignal.timeout(15000), redirect: "error"});
    const metadata = response.status === 200 ? await response.json() : {};
    entries.push({...expected, state: assessPublishedArtifact(response.status, metadata, expected)});
  }
  return {schemaVersion:1, sourceCommit:execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(), generatedAtUtc:new Date().toISOString(), entries};
}
/** Require publication to use the exact preflight manifest uploaded for review. */
export function verifyReleasePlan(recorded, current) {
  if (recorded?.schemaVersion !== 1 || recorded.sourceCommit !== current.sourceCommit ||
      !Array.isArray(recorded.entries) || recorded.entries.length !== current.entries.length)
    throw new Error("Release preflight source or package set changed; rebuild and review artifacts");
  for (let index = 0; index < current.entries.length; index++) {
    const previous = recorded.entries[index];
    const next = current.entries[index];
    for (const field of ["name", "version", "integrity", "file"])
      if (previous?.[field] !== next[field]) throw new Error(`Release preflight ${field} changed; rebuild and review artifacts`);
    if (!["unpublished", "identical"].includes(previous.state) ||
        (previous.state === "identical" && next.state !== "identical"))
      throw new Error("Previously verified publication is no longer present");
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const artifacts = path.resolve(root, "release-artifacts");
  const plan = await planNpmRelease(root, artifacts);
  const identityFile = path.join(artifacts, "release-identity.json");
  if (process.argv.includes("--publish")) {
    // Never replace the preflight record after it has been uploaded as a release artifact.
    verifyReleasePlan(JSON.parse(readFileSync(identityFile, "utf8")), plan);
    for (const entry of plan.entries) {
      if (entry.state === "identical") continue;
      execFileSync("npm",["publish",entry.file,"--access","public","--provenance"],{cwd:root,stdio:"inherit"});
      const response = await fetch(`https://registry.npmjs.org/${entry.name}/${entry.version}`,{signal:AbortSignal.timeout(15000)});
      assessPublishedArtifact(response.status,response.status === 200 ? await response.json() : {},entry);
      if (response.status !== 200) throw new Error(`Publication not yet verified: ${entry.name}`);
    }
  }
  else writeFileSync(identityFile, JSON.stringify(plan,null,2)+"\n");
  console.log(JSON.stringify(plan.entries.map(({name,version,state})=>({name,version,state})),null,2));
}
