#!/usr/bin/env node
/** Verify exact release identities before any publication; reject silent reuse of unrelated existing versions. */
import {readFileSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
export function assessPublishedArtifact(status, metadata, expected) {
  if (status === 404) return "unpublished";
  if (status !== 200) throw new Error(`Cannot verify ${expected.name}: registry returned ${status}`);
  if (metadata.name !== expected.name || metadata.version !== expected.version || metadata.dist?.integrity !== expected.integrity)
    throw new Error(`Published artifact differs from this release: ${expected.name}@${expected.version}; select a new release version`);
  return "identical";
}
export async function planNpmRelease(root, artifacts, fetcher = fetch) {
  const canonical = JSON.parse(readFileSync(path.join(root,"package.json"),"utf8"));
  const entries = [];
  for (const name of ["platformio-mcp","pio-mcp","pio-agent"]) {
    const manifest = name === "platformio-mcp" ? canonical : JSON.parse(readFileSync(path.join(root,"packages",name,"package.json"),"utf8"));
    if (manifest.name !== name || manifest.version !== canonical.version || (name !== "platformio-mcp" && manifest.dependencies?.["platformio-mcp"] !== canonical.version)) throw new Error("Release package names, versions, or exact alias pins differ");
    const file = path.resolve(artifacts, `${name}-${manifest.version}.tgz`);
    const integrity = "sha512-" + createHash("sha512").update(readFileSync(file)).digest("base64");
    const expected = {name, version: manifest.version, integrity, file};
    const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(manifest.version)}`, {signal: AbortSignal.timeout(15000), redirect: "error"});
    const metadata = response.status === 200 ? await response.json() : {};
    entries.push({...expected, state: assessPublishedArtifact(response.status, metadata, expected)});
  }
  return {schemaVersion:1, sourceCommit:execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(), generatedAtUtc:new Date().toISOString(), entries};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const artifacts = path.resolve(root, "release-artifacts");
  const plan = await planNpmRelease(root, artifacts);
  writeFileSync(path.join(artifacts,"release-identity.json"),JSON.stringify(plan,null,2)+"\n");
  if (process.argv.includes("--publish")) {
    for (const entry of plan.entries) {
      if (entry.state === "identical") continue;
      execFileSync("npm",["publish",entry.file,"--access","public","--provenance"],{cwd:root,stdio:"inherit"});
      const response = await fetch(`https://registry.npmjs.org/${entry.name}/${entry.version}`,{signal:AbortSignal.timeout(15000)});
      assessPublishedArtifact(response.status,response.status === 200 ? await response.json() : {},entry);
      if (response.status !== 200) throw new Error(`Publication not yet verified: ${entry.name}`);
    }
  }
  console.log(JSON.stringify(plan.entries.map(({name,version,state})=>({name,version,state})),null,2));
}
