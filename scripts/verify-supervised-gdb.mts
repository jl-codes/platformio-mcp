/** Verify supervised native GDB symbol initialization and cleanup against an offline ELF; no target attachment. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { DebugProcess } from "../src/core/debug/debug-process.ts";
const [python, executable, sourceElf, evidencePath] = process.argv.slice(2);
for (const value of [python, executable, sourceElf])
  assert(
    value && path.isAbsolute(value),
    "Pass absolute Python, GDB and ELF paths.",
  );
const root = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "pio-supervised-gdb-")),
);
let owner: DebugProcess | undefined;
let prepared = 0,
  released = 0;
try {
  const elfPath = path.join(root, "firmware.elf");
  await fs.copyFile(sourceElf, elfPath);
  owner = await DebugProcess.start({
    executable,
    trustedDebuggerRoots: [path.dirname(executable)],
    projectDir: root,
    elfPath,
    supervisorPython: python,
    startupTimeoutMs: 15000,
    custody: {
      prepareSpawn: async () => {
        prepared++;
      },
      releaseAfterExit: () => {
        released++;
      },
    },
    // This fixture never opens a probe/backend; process-group proof is still enforced by DebugProcess.
    confirmProbeReleased: async () => true,
  });
  const pid = owner.state().pid!;
  assert(Number.isSafeInteger(pid) && pid > 0);
  assert.equal(prepared, 1);
  assert.equal(released, 0);
  assert.equal(owner.state().closed, false);
  await owner.cleanupProcess();
  assert.equal(owner.state().cleanupPending, false);
  assert.equal(released, 1);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  const evidence = {
    observedAt: new Date().toISOString(),
    platform: process.platform,
    physicalDeviceContacted: false,
    nativeGdbInitialized: true,
    isolatedSupervisor: true,
    processExited: true,
    cleanupConfirmed: true,
    fixtureProbeCallbacksOnly: true,
  };
  if (evidencePath)
    await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
} finally {
  if (owner) await owner.cleanupProcess();
  await fs.rm(root, { recursive: true, force: true });
}
