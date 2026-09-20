#!/usr/bin/env node
/** Produce only POL-05 evidence from the complete installer regression suite on a clean revision. */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const testPath = "tests/codex-config-installer.test.ts";
const requiredCases = [
  "supports valid alternate representations:",
  "preserves permissions, comments, multiline values and separated environment tables",
  "preserves custom launchers and their permission selectors",
  "retains runtime policy and compatibility selectors",
  "leaves invalid files byte-for-byte unchanged:",
  "leaves the original intact and cleans temporary files if replacement fails",
  "does not overwrite a remote server with a conflicting local transport",
  "uses CODEX_HOME and rejects explicitly empty paths",
];

/** Missing scenarios, skipped cases, or unsuccessful reports cannot become acceptance evidence. */
export function validateConfigReport(report) {
  const suites = report.testResults;
  if (!report.success || !Array.isArray(suites) || suites.length !== 1 ||
      !suites[0].name.replaceAll("\\", "/").endsWith("/" + testPath)) throw new Error("Unexpected installer test report");
  const assertions = suites[0].assertionResults;
  if (!Array.isArray(assertions) || assertions.length !== 17 || assertions.some(item => item.status !== "passed") ||
      report.numFailedTests !== 0 || report.numPendingTests !== 0 || report.numTodoTests !== 0 ||
      report.numPassedTests !== assertions.length || report.numTotalTests !== assertions.length ||
      requiredCases.some((name, index) => assertions.filter(item => item.title?.startsWith(name)).length !== (index === 0 ? 8 : index === 4 ? 3 : 1))) throw new Error("Installer coverage is missing, skipped, or failed");
  return assertions.length;
}

/** Execute the pinned suite and retain its raw report and source alongside a narrowly scoped manifest. */
export function produceConfigAcceptance(output) {
  const directory = path.resolve(output);
  if (existsSync(directory)) throw new Error("Evidence output must be new");
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  if (git(["status", "--porcelain", "--untracked-files=no"])) throw new Error("Acceptance requires a clean tracked checkout");
  const commit = git(["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Invalid source revision");
  mkdirSync(directory, { recursive: true });
  const args = [path.join(root, "node_modules/vitest/vitest.mjs"), "run", testPath, "--reporter=json", "--outputFile=" + path.join(directory, "vitest.json")];
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  writeFileSync(path.join(directory, "execution.log"), (result.stdout ?? "") + (result.stderr ?? ""));
  if (result.error || result.status !== 0) throw new Error("Installer acceptance execution failed; no passing manifest produced");
  const passed = validateConfigReport(JSON.parse(readFileSync(path.join(directory, "vitest.json"), "utf8")));
  if (git(["rev-parse", "HEAD"]) !== commit || git(["status", "--porcelain", "--untracked-files=no"])) throw new Error("Checkout changed during acceptance");
  const requirement = JSON.parse(readFileSync(path.join(root, "docs/reviews/platformio-acceptance-requirements.json"), "utf8")).requirements.find(item => item.id === "POL-05");
  if (!requirement || requirement.kind !== "integration") throw new Error("Installer acceptance requirement changed");
  const timestamp = new Date().toISOString();
  const environment = `${os.platform()} ${os.release()} ${os.arch()}; Node ${process.version}`;
  const procedure = "node node_modules/vitest/vitest.mjs run tests/codex-config-installer.test.ts --reporter=json";
  for (const source of [testPath, "scripts/installers/codex.js"]) writeFileSync(path.join(directory, path.basename(source)), readFileSync(path.join(root, source)));
  const evidence = { sourceCommit: commit, outcome: "pass", kind: "integration", requirements: ["POL-05"], assertions: [requirement.assertion], passed, failed: 0, skipped: 0, timestamp, environment, procedure, scope: "Installer configuration regression only; no host runtime, hardware or publication acceptance." };
  writeFileSync(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  const artifact = name => ({ path: name, sha256: createHash("sha256").update(readFileSync(path.join(directory, name))).digest("hex") });
  const entry = { requirementId: "POL-05", implementationStatus: "complete", outcome: "pass", expectedAssertion: requirement.assertion, timestamp, environment, procedure, executor: process.env.GITHUB_ACTIONS === "true" ? `GitHub Actions ${process.env.GITHUB_RUN_ID}` : "local Node installer regression runner", evidence: artifact("evidence.json"), artifacts: ["vitest.json", "execution.log", "codex-config-installer.test.ts", "codex.js"].map(artifact) };
  writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ schemaVersion: 1, sourceCommit: commit, entries: [entry] }, null, 2) + "\n");
  return { sourceCommit: commit, requirement: "POL-05", passed };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || process.argv.length !== 3) throw new Error("Usage: produce-config-acceptance.mjs <new-output-directory>");
  console.log(JSON.stringify(produceConfigAcceptance(process.argv[2])));
}
