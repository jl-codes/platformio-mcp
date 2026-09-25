/** Evidence retrieval requires verified producer identity before any artifact download. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseEvidenceRuns,
  downloadEvidence,
} from "../scripts/download-parity-evidence.mjs";
const repo = "jl-codes/platformio-mcp",
  commit = "a".repeat(40);
const run = (id) => ({
  id: Number(id),
  status: "completed",
  conclusion: "success",
  head_sha: commit,
  repository: { full_name: repo },
  head_repository: { full_name: repo },
  html_url: `https://github.com/${repo}/actions/runs/${id}`,
});
test("accepts bounded numeric IDs and rejects duplicates or command syntax", () => {
  assert.deepEqual(parseEvidenceRuns("123, 456\n789"), ["123", "456", "789"]);
  for (const value of [
    "",
    "123 123",
    "0",
    "1;echo",
    "$(cmd)",
    "--repo",
    Array.from({ length: 65 }, (_, i) => i + 1).join(","),
  ])
    assert.throws(() => parseEvidenceRuns(value));
});
test("checks all producers before download and retains their identities", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-evidence-input-"));
  try {
    const calls = [];
    const result = downloadEvidence(
      "123,456",
      repo,
      commit,
      path.join(root, "downloads"),
      (args) => {
        calls.push(args);
        return args[0] === "api"
          ? JSON.stringify(run(args[1].split("/").at(-1)))
          : "";
      },
    );
    assert.deepEqual(
      calls.map((args) => args[0]),
      ["api", "api", "run", "run"],
    );
    assert.equal(result.packets.length, 2);
    assert.equal(result.observations[1].headSha, commit);
    assert(calls[2].includes("platformio-parity-evidence"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("rejects incomplete, failed, stale, foreign or substituted runs before download", () => {
  for (const patch of [
    { status: "in_progress" },
    { conclusion: "failure" },
    { head_sha: "b".repeat(40) },
    { head_repository: { full_name: "foreign/fork" } },
    { repository: { full_name: "foreign/repo" } },
    { id: 456 },
  ]) {
    let downloads = 0;
    assert.throws(
      () =>
        downloadEvidence("123", repo, commit, "unused", (args) => {
          if (args[0] !== "api") downloads++;
          return JSON.stringify({ ...run("123"), ...patch });
        }),
      /not a successful/,
    );
    assert.equal(downloads, 0);
  }
});
