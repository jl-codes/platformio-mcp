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
