#!/usr/bin/env node
/** Report changed namespace risks through workflow status; never contact package owners. */
import {readFileSync, appendFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

/** Version-only updates are routine; changed ownership signals and newly failed lookups need review. */
export function actionableChanges(report) {
  return (report.changes ?? []).filter(change =>
    change.changed.some(field => ["repository", "maintainers"].includes(field)) ||
    (change.changed.includes("integrity") && !change.changed.includes("version")) ||
    (change.changed.includes("status") && ["third_party", "registry_blocked", "unknown"].includes(change.after))
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const changes = actionableChanges(report);
  const summary = `Namespace audit: ${report.lookups ?? 0} lookups; ${changes.length} changed observations need review. See the namespace-observations artifact. Public metadata does not establish ownership.\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary.trim());
  if (changes.length) process.exitCode = 1;
}
