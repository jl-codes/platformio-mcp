/** Immutable release retries must verify every existing byte identity before upload. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planGithubAssets } from "../scripts/github-release-assets.mjs";
const local = [{ name: "package.tgz", size: 20, sha256: "a".repeat(64) }];
const remote = { name: "package.tgz", size: 20, state: "uploaded", digest: `sha256:${"a".repeat(64)}` };
test("reuses identical names and identifies genuinely missing assets", () => {
  assert.equal(planGithubAssets(local, [remote])[0].state, "identical");
  assert.equal(planGithubAssets(local, [])[0].state, "missing");
});
test("rejects conflicting bytes, incomplete uploads and duplicate remote names", () => {
  for (const changed of [{ ...remote, digest: "sha256:other" }, { ...remote, size: 21 }, { ...remote, state: "starter" }, { ...remote, digest: null }]) assert.throws(() => planGithubAssets(local, [changed]));
  assert.throws(() => planGithubAssets(local, [remote, remote]));
});
test("rejects names with upload-label or glob interpretation", () => {
  for (const name of ["package#label", "*.tgz", "../file", "-file"]) assert.throws(() => planGithubAssets([{ ...local[0], name }], []));
  assert.throws(() => planGithubAssets([...local, ...local], []));
});

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { attachGithubAssets } from "../scripts/github-release-assets.mjs";
const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
test("retry downloads legacy assets, uploads only missing files and verifies afterward", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pio-gh-assets-"));
  try {
    writeFileSync(path.join(directory, "existing.tgz"), "same");
    writeFileSync(path.join(directory, "missing.tgz"), "new");
    const assets = [{ name: "existing.tgz", size: 4, state: "uploaded", digest: null }];
    let uploads = 0, downloads = 0, inspections = 0;
    const gh = args => {
      if (args[0] === "api") { inspections++; return JSON.stringify({ tag_name: "v4.0.0", assets }); }
      if (args[1] === "download") {
        downloads++; writeFileSync(path.join(args[args.indexOf("--dir") + 1], "existing.tgz"), "same"); return "";
      }
      assert.equal(args[1], "upload");
      assert(!args.includes("--clobber"));
      uploads++;
      const file = args[3], bytes = readFileSync(file);
      assets.push({ name: path.basename(file), size: bytes.length, state: "uploaded", digest: hash(bytes) });
      return "";
    };
    const result = await attachGithubAssets("v4.0.0", directory, "jl-codes/platformio-mcp", gh);
    assert.equal(uploads, 1); assert.equal(downloads, 2); assert.equal(inspections, 2);
    assert(result.every(entry => entry.state === "identical"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("a conflicting later artifact prevents uploading an earlier missing artifact", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pio-gh-assets-"));
  try {
    writeFileSync(path.join(directory, "a-missing.tgz"), "new");
    writeFileSync(path.join(directory, "z-conflict.tgz"), "local");
    let uploads = 0;
    const gh = args => {
      if (args[0] === "api") return JSON.stringify({ tag_name: "v4.0.0", assets: [{ name: "z-conflict.tgz", size: 5, state: "uploaded", digest: hash("other") }] });
      uploads++; return "";
    };
    await assert.rejects(attachGithubAssets("v4.0.0", directory, "jl-codes/platformio-mcp", gh), /differs/);
    assert.equal(uploads, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
