#!/usr/bin/env node
/** Retrieve acceptance evidence only from successful same-repository, same-revision Actions runs. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { collectAcceptance } from "./collect-parity-acceptance.mjs";

/** Validate the operator-selected run inventory without shell interpretation or duplicate downloads. */
export function parseEvidenceRuns(value) {
  if (typeof value !== "string" || value.length > 4096)
    throw new Error("Invalid evidence run list");
  const runs = value.trim().split(/[ ,\r\n]+/);
  if (
    !runs.length ||
    runs.length > 64 ||
    runs.some((id) => !/^[1-9][0-9]{0,19}$/.test(id)) ||
    new Set(runs).size !== runs.length
  )
    throw new Error("Specify 1�64 distinct numeric evidence run IDs");
  return runs;
}

/** Inspect every run before downloads; read-only GitHub access never starts or reruns an evidence producer. */
export function downloadEvidence(runs, repository, commit, directory, runGh) {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    !/^[a-f0-9]{40}$/.test(commit)
  )
    throw new Error("Explicit repository and full revision required");
  const ids = parseEvidenceRuns(runs);
  const gh =
    runGh ??
    ((args) =>
      execFileSync("gh", args, {
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      }));
  const observations = ids.map((id) => {
    const run = JSON.parse(
      gh(["api", `repos/${repository}/actions/runs/${id}`]),
    );
    if (
      String(run.id) !== id ||
      run.status !== "completed" ||
      run.conclusion !== "success" ||
      run.head_sha !== commit ||
      run.repository?.full_name !== repository ||
      run.head_repository?.full_name !== repository
    )
      throw new Error(
        `Evidence run ${id} is not a successful same-repository run at the requested revision`,
      );
    return {
      id,
      headSha: run.head_sha,
      conclusion: run.conclusion,
      url: run.html_url,
    };
  });
  const root = path.resolve(directory);
  if (fs.existsSync(root))
    throw new Error("Evidence download directory already exists");
  fs.mkdirSync(root, { recursive: true });
  const packets = observations.map((run) => {
    const destination = path.join(root, run.id);
    gh([
      "run",
      "download",
      run.id,
      "--repo",
      repository,
      "--name",
      "platformio-parity-evidence",
      "--dir",
      destination,
    ]);
    return destination;
  });
  return { packets, observations };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [destination] = process.argv.slice(2);
  if (!destination) throw new Error("Specify a new output directory");
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "pio-evidence-download-"),
  );
  try {
    const input = downloadEvidence(
      process.env.EVIDENCE_RUN_IDS,
      process.env.GITHUB_REPOSITORY,
      process.env.GITHUB_SHA,
      path.join(temporary, "inputs"),
    );
    const result = collectAcceptance(
      input.packets,
      destination,
      process.env.GITHUB_SHA,
    );
    fs.writeFileSync(
      path.join(result.packetDirectory, "source-runs.json"),
      JSON.stringify(
        {
          sourceCommit: process.env.GITHUB_SHA,
          repository: process.env.GITHUB_REPOSITORY,
          runs: input.observations,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    console.log(JSON.stringify(result));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
