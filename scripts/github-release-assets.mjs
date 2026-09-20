#!/usr/bin/env node
/** Reuse only byte-identical GitHub release assets; never overwrite a published name. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Reject duplicate names, incomplete uploads and conflicting bytes before any upload. */
export function planGithubAssets(local, remote) {
  const names = new Set();
  for (const entry of local) {
    if (names.has(entry.name) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.name)) throw new Error("Invalid or duplicate local asset name");
    names.add(entry.name);
  }
  return local.map(entry => {
    const matches = remote.filter(asset => asset.name === entry.name);
    if (!matches.length) return { ...entry, state: "missing" };
    if (matches.length !== 1 || matches[0].state !== "uploaded" || matches[0].size !== entry.size || matches[0].digest !== `sha256:${entry.sha256}`)
      throw new Error(`Published GitHub asset differs or is incomplete: ${entry.name}`);
    return { ...entry, state: "identical" };
  });
}
async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Verify the entire asset set, upload missing names without clobber, then verify the resulting release. */
export async function attachGithubAssets(tag, directory, repo = process.env.GITHUB_REPOSITORY) {
  if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !/^v[0-9][A-Za-z0-9.+-]*$/.test(tag)) throw new Error("Explicit repository and version tag required");
  const gh = args => execFileSync("gh", args, { encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  const local = [];
  for (const name of readdirSync(directory).sort()) {
    const file = path.resolve(directory, name), stat = statSync(file);
    if (!stat.isFile()) continue;
    local.push({ name, file, size: stat.size, sha256: await sha256(file) });
  }
  if (!local.length) throw new Error("No release assets");
  const inspect = async () => {
    const release = JSON.parse(gh(["api", `repos/${repo}/releases/tags/${encodeURIComponent(tag)}`]));
    if (release.tag_name !== tag || !Array.isArray(release.assets)) throw new Error("Release identity mismatch");
    // Older GitHub assets may lack digests; download exactly that name and compare actual bytes.
    for (const asset of release.assets) {
      const expected = local.find(entry => entry.name === asset.name);
      if (!expected) continue;
      if (asset.size !== expected.size || asset.state !== "uploaded") throw new Error(`Published asset is incomplete or differs: ${asset.name}`);
      if (asset.digest) continue;
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset.name)) throw new Error("Invalid remote asset name");
      const temporary = mkdtempSync(path.join(os.tmpdir(), "pio-release-asset-"));
      try {
        gh(["release", "download", tag, "--repo", repo, "--pattern", asset.name, "--dir", temporary]);
        asset.digest = `sha256:${await sha256(path.join(temporary, asset.name))}`;
      } finally { rmSync(temporary, { recursive: true, force: true }); }
    }
    return release.assets;
  };
  const plan = planGithubAssets(local, await inspect());
  for (const entry of plan) if (entry.state === "missing") {
    if (await sha256(entry.file) !== entry.sha256) throw new Error(`Local artifact changed: ${entry.name}`);
    gh(["release", "upload", tag, entry.file, "--repo", repo]);
  }
  const verified = planGithubAssets(local, await inspect());
  if (verified.some(entry => entry.state !== "identical")) throw new Error("Published assets are missing");
  return verified.map(({ name, sha256, state }) => ({ name, sha256, state }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await attachGithubAssets(process.argv[2], process.argv[3])));
}
