/** Verify native supervised PPK2 capability failure and cleanup without an installed API or physical port. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Ppk2Process } from "../src/core/power/ppk2-process.ts";
const python = process.argv[2];
assert(python && path.isAbsolute(python), "Pass an absolute Python interpreter.");
const probe = spawnSync(python, ["-I", "-c", "import importlib.util; print('missing' if importlib.util.find_spec('ppk2_api') is None else 'present')"], { encoding: "utf8", timeout: 10000, windowsHide: true });
assert.equal(probe.status, 0);
assert.equal(probe.stdout.trim(), "missing", "This fixture requires an isolated interpreter without ppk2-api; it must never contact a meter.");
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "pio-ppk2-owner-")));
let released = 0, prepared = 0;
const owner = new Ppk2Process({ pythonExecutable: python, cwd: root, request: { port: path.join(root, "nonexistent-meter"), mode: "ampere", voltageMv: 3300, currentLimitMa: 50, seconds: 0.001 }, custody: { prepareSpawn: async () => { prepared++; }, releaseAfterExit: () => { released++; } } });
try {
  await assert.rejects(owner.collect(), { code: "PPK2_API_MISSING" });
  assert.equal(prepared, 1); assert.equal(released, 1);
  assert.equal(owner.state().cleanupPending, false);
  assert.equal(owner.state().processClosed, true);
  console.log(JSON.stringify({ passed: true, platform: process.platform, physicalDeviceContacted: false, missingDependencyReported: true, supervisedCleanupConfirmed: true }));
} finally {
  await owner.cleanupProcess();
  await fs.rm(root, { recursive: true, force: true });
}
