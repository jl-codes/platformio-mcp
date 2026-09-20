/** Verify Windows backend descendant shutdown using local Python fixtures; no hardware is contacted. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { WINDOWS_BACKEND_SUPERVISOR } from "../src/core/debug/windows-backend-supervisor.ts";
const python = process.argv[2];
assert(
  process.platform === "win32" && python && path.isAbsolute(python),
  "Pass an absolute Windows Python executable.",
);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "pio-debug-supervisor-"));
const fixture = path.join(root, "fixture.py");
await fs.writeFile(
  fixture,
  `import json, subprocess, sys, time
child = subprocess.Popen([sys.executable, "-I", "-c", "import time; time.sleep(60)"])
print(json.dumps(dict(descendantPid=child.pid)), flush=True)
if sys.argv[1] != "natural": time.sleep(60)
`,
);
const results: unknown[] = [];
try {
  for (const mode of ["stop", "owner_eof", "natural"]) {
    const child = spawn(python, ["-I", "-c", WINDOWS_BACKEND_SUPERVISOR], {
      windowsHide: true,
      stdio: "pipe",
    });
    let stdout = "",
      stderr = "",
      requested = false;
    child.stdin.on("error", () => {});
    const maybeStop = () => {
      if (
        requested ||
        !stdout.includes('"started"') ||
        !stderr.includes("descendantPid")
      )
        return;
      requested = true;
      if (mode === "stop") child.stdin.write("x");
      if (mode === "owner_eof") child.stdin.end();
    };
    child.stdout.on("data", (value) => {
      stdout += value.toString();
      maybeStop();
    });
    child.stderr.on("data", (value) => {
      stderr += value.toString();
      maybeStop();
    });
    const closed = new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Supervisor deadline exceeded"));
      }, 15000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    child.stdin.write(
      JSON.stringify({
        executable: python,
        cwd: root,
        arguments: ["-I", fixture, mode],
      }) + "\n",
    );
    const exitCode = await closed;
    assert.equal(exitCode, 0, stdout + stderr);
    const events = stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.event),
      ["started", "stopped"],
    );
    assert.equal(events[1].cleanupConfirmed, true);
    const descendant = JSON.parse(stderr.trim()).descendantPid;
    for (const pid of [events[0].pid, descendant]) {
      assert(Number.isSafeInteger(pid) && pid > 0);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    }
    results.push({
      mode,
      cleanupConfirmed: true,
      rootExited: true,
      descendantExited: true,
    });
  }
  const evidence = {
    observedAt: new Date().toISOString(),
    platform: process.platform,
    physicalDeviceContacted: false,
    supervisorSha256: createHash("sha256")
      .update(WINDOWS_BACKEND_SUPERVISOR)
      .digest("hex"),
    results,
  };
  if (process.argv[3])
    await fs.writeFile(
      process.argv[3],
      JSON.stringify(evidence, null, 2) + "\n",
    );
  console.log(JSON.stringify(evidence));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
