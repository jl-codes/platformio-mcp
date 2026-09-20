/** Verify backend descendant shutdown using local Python fixtures; no hardware is contacted. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { DebugBackendProcess } from "../src/core/debug/debug-backend-process.ts";
import { POSIX_BACKEND_SUPERVISOR } from "../src/core/debug/posix-backend-supervisor.ts";
import { WINDOWS_BACKEND_SUPERVISOR } from "../src/core/debug/windows-backend-supervisor.ts";
const python = process.argv[2];
assert(
  python && path.isAbsolute(python),
  "Pass an absolute Python executable.",
);
const supervisor =
  process.platform === "win32"
    ? WINDOWS_BACKEND_SUPERVISOR
    : POSIX_BACKEND_SUPERVISOR;
const root = await fs.mkdtemp(path.join(os.tmpdir(), "pio-debug-supervisor-"));
const fixture = path.join(root, "fixture.py");
await fs.writeFile(
  fixture,
  `import json, subprocess, sys, time
child = subprocess.Popen([sys.executable, "-I", "-c", "import time; time.sleep(60)"])
print(json.dumps(dict(descendantPid=child.pid)), flush=True)
if sys.argv[1] == "interactive":
    print(sys.stdin.readline().strip(), flush=True)
    print(json.dumps(dict(event="stopped", cleanupConfirmed=True)), flush=True)
if sys.argv[1] != "natural": time.sleep(60)
`,
);
const results: unknown[] = [];
try {
  for (const mode of ["stop", "owner_eof", "natural"]) {
    const child = spawn(python, ["-I", "-c", supervisor], {
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
  const owner = new DebugBackendProcess({
    pythonExecutable: python,
    command: {
      executable: python,
      cwd: root,
      arguments: ["-I", fixture, "stop"],
    },
  });
  try {
    await owner.waitStarted();
    const deadline = Date.now() + 5000;
    while (
      !owner.state().outputTail.includes("descendantPid") &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    const descendant = JSON.parse(
      owner.state().outputTail.trim(),
    ).descendantPid;
    const backendPid = owner.state().pid!;
    await owner.cleanupProcess();
    assert.equal(owner.state().cleanupPending, false);
    for (const pid of [backendPid, descendant])
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    results.push({
      mode: "node_owner",
      cleanupConfirmed: true,
      rootExited: true,
      descendantExited: true,
    });
  } finally {
    await owner.cleanupProcess();
  }
  {
    let output = "";
    const interactive = new DebugBackendProcess({
      pythonExecutable: python,
      command: {
        executable: python,
        cwd: root,
        arguments: ["-I", fixture, "interactive"],
      },
      onStdout: (data) => {
        output += data.toString("utf8");
      },
    });
    try {
      await interactive.waitStarted();
      await interactive.writeStdin(Buffer.from("42-stack-list-frames\n"));
      const deadline = Date.now() + 5000;
      while (
        !output.includes('"cleanupConfirmed": true') &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert(
        /42-stack-list-frames\r?\n/.test(output),
        "interactive echo missing: " + output,
      );
      assert(
        output.includes('"cleanupConfirmed": true'),
        "fixture output missing",
      );
      assert.equal(
        interactive.state().cleanupPending,
        true,
        "child output must not forge supervisor state",
      );
      const descendant = JSON.parse(output.split(/\r?\n/)[0]).descendantPid;
      const pid = interactive.state().pid!;
      await interactive.cleanupProcess();
      assert.equal(interactive.state().cleanupPending, false);
      for (const candidate of [pid, descendant])
        assert.throws(() => process.kill(candidate, 0), { code: "ESRCH" });
      results.push({
        mode: "interactive_node_owner",
        inputEchoed: true,
        outputCannotForgeControl: true,
        cleanupConfirmed: true,
        rootExited: true,
        descendantExited: true,
      });
    } finally {
      await interactive.cleanupProcess();
    }
  }
  const evidence = {
    observedAt: new Date().toISOString(),
    platform: process.platform,
    physicalDeviceContacted: false,
    supervisorSha256: createHash("sha256").update(supervisor).digest("hex"),
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
