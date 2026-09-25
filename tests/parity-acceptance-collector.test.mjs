/** Synthetic packets test aggregation integrity only; these fixtures are never release acceptance evidence. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectAcceptance } from "../scripts/collect-parity-acceptance.mjs";
import { validateAcceptance } from "../scripts/validate-parity-acceptance.mjs";
const commit = "a".repeat(40);
const catalog = JSON.parse(fs.readFileSync(new URL("../docs/reviews/platformio-acceptance-requirements.json", import.meta.url)));
const requirements = catalog.requirements;
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-acceptance-collector-"));
  try {
    const packets = [0, 1].map(index => {
      const directory = path.join(root, `input-${index}`);
      fs.mkdirSync(directory);
      const entries = requirements.filter((_, i) => i % 2 === index).map(req => {
        const deferral = req.deferredCertification ? {deferralDecision: catalog.releaseScope.decisionId, deferredCertification: req.deferredCertification} : {};
        if (req.releaseGate === "deferred") return {requirementId: req.id, outcome: "deferred", expectedAssertion: req.assertion, evidence: null, artifacts: [], ...deferral};
        const assertion = req.releaseAssertion ?? req.assertion;
        const evidence = {sourceCommit: commit, outcome: "pass", kind: req.kind, requirements: [req.id], assertions: [assertion], skipped: 0, failed: 0, passed: 1};
        const bytes = JSON.stringify(evidence);
        const artifact = {path: req.id + ".json", sha256: createHash("sha256").update(bytes).digest("hex")};
        fs.writeFileSync(path.join(directory, artifact.path), bytes);
        return {requirementId: req.id, implementationStatus: "complete", outcome: "pass", expectedAssertion: assertion, ...deferral, procedure: "synthetic collector fixture", executor: "test", environment: "temporary fixture", timestamp: new Date().toISOString(), evidence: artifact, artifacts: [artifact]};
      });
      fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({schemaVersion: 1, sourceCommit: commit, entries}));
      return directory;
    });
    run(packets, path.join(root, "output"));
  } finally {fs.rmSync(root, {recursive: true, force: true});}
}
test("combines disjoint full-inventory evidence while preserving source packets", () => fixture((packets, out) => {
  const before = fs.readFileSync(path.join(packets[0], "manifest.json"));
  assert.equal(collectAcceptance(packets, out, commit).outcome, "pass");
  const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json")));
  assert.equal(validateAcceptance(manifest, out, commit).requirements, requirements.length);
  assert.deepEqual(fs.readFileSync(path.join(packets[0], "manifest.json")), before);
  assert.throws(() => collectAcceptance(packets, out, commit), /already exists/);
}));
test("rejects incomplete, duplicate and wrong-revision packets without publishing output", () => fixture((packets, out) => {
  assert.throws(() => collectAcceptance(packets.slice(0, 1), out, commit), /incomplete/);
  assert.throws(() => collectAcceptance([packets[0], packets[0]], out, commit), /Duplicate/);
  assert.throws(() => collectAcceptance(packets, out, "b".repeat(40)), /revision/);
  assert.equal(fs.existsSync(out), false);
}));
test("rejects altered artifacts and escaping references", () => fixture((packets, out) => {
  const file = path.join(packets[0], "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(file));
  const original = manifest.entries[0].evidence;
  fs.appendFileSync(path.join(packets[0], original.path), " ");
  assert.throws(() => collectAcceptance(packets, out, commit), /hash mismatch/);
  manifest.entries[0].evidence = {...original, path: "../input-1/manifest.json"};
  fs.writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => collectAcceptance(packets, out, commit), /escapes/);
  assert.equal(fs.existsSync(out), false);
}));

test("records certifications as deferred without counting them as passed", () => fixture((packets, out) => {
  const result = collectAcceptance(packets, out, commit);
  assert.equal(result.passedRequirements, requirements.length - 1);
  assert.equal(result.deferredCertifications.length, 8);
  assert.ok(result.deferredCertifications.every(item => item.outcome === "deferred"));
}));
test("rejects invented deferrals and missing retained ESP32 evidence", () => fixture((packets, out) => {
  const file = path.join(packets[0], "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(file));
  manifest.entries[0].deferralDecision = catalog.releaseScope.decisionId;
  fs.writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => collectAcceptance(packets, out, commit), /Unapproved/);
  delete manifest.entries[0].deferralDecision;
  fs.writeFileSync(file, JSON.stringify(manifest));
  for (const packet of packets) {
    const name = path.join(packet, "manifest.json");
    const value = JSON.parse(fs.readFileSync(name));
    const esp = value.entries.find(item => item.requirementId === "PAR-HW-07");
    if (esp) { esp.outcome = "deferred"; esp.evidence = null; esp.artifacts = []; fs.writeFileSync(name, JSON.stringify(value)); }
  }
  assert.throws(() => collectAcceptance(packets, out, commit), /Incomplete acceptance: PAR-HW-07/);
}));
test("rejects a fabricated pass for deferred Cortex-M certification", () => fixture((packets, out) => {
  for (const packet of packets) {
    const name = path.join(packet, "manifest.json");
    const value = JSON.parse(fs.readFileSync(name));
    const cortex = value.entries.find(item => item.requirementId === "PAR-HW-02");
    if (cortex) { cortex.outcome = "pass"; fs.writeFileSync(name, JSON.stringify(value)); }
  }
  assert.throws(() => collectAcceptance(packets, out, commit), /Invalid source artifact|Invalid evidence|Deferred certification/);
}));
