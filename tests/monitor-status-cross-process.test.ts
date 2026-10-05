/** Fresh one-shot CLI status observes an identity-verified harmless child without hardware or watchers. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/** Terminate only this test's owned Node child, with bounded confirmation. */
async function stopFixture(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Fixture process did not exit")),
          5000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

it("sees a monitor from a separate registration process and does not alter its tracking", async () => {
  const testRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "pio-status-cross-process-")),
  );
  const project = path.join(testRoot, "project");
  const other = path.join(testRoot, "other-project");
  fs.mkdirSync(project);
  fs.mkdirSync(other);
  const logFile = path.join(project, "monitor.log");
  fs.writeFileSync(logFile, "harmless monitor fixture\n");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    windowsHide: true,
    stdio: "ignore",
  });
  await once(child, "spawn");
  const env = { ...process.env, PIO_MCP_DATA_DIR: testRoot };
  delete env.PIO_MCP_POLICY_FILE;
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const managerUrl = new URL("../src/utils/process-manager.ts", import.meta.url)
    .href;
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const registryPath = path.join(
    testRoot,
    "serial_monitors",
    "monitor-pids.json",
  );
  const query = (selectedProject: string) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          cliPath,
          "monitor-status",
          "--port",
          "com42",
          "--project-dir",
          selectedProject,
          "--json",
        ],
        { cwd, env, timeout: 60000, encoding: "utf8", windowsHide: true },
      ),
    );
  try {
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
      const { registerPioMonitorPid } = await import(${JSON.stringify(managerUrl)});
      await registerPioMonitorPid("COM42", ${child.pid}, ${JSON.stringify(project)}, undefined, ${JSON.stringify(logFile)}, "cross-process-task", undefined, { baudRate: 57600, environment: "fixture" });
    `,
      ],
      { cwd, env, timeout: 60000, windowsHide: true, stdio: "pipe" },
    );
    // Status context remains durable after command history is rotated away.
    fs.writeFileSync(
      path.join(
        project,
        ".pio-mcp-workspace",
        "registry",
        "command_history.json",
      ),
      "[]",
    );
    const before = ["", ".identities.json", ".metadata.json"].map((suffix) =>
      fs.readFileSync(registryPath + suffix, "utf8"),
    );
    expect(query(project)).toMatchObject({
      state: "active",
      port: "COM42",
      taskId: "cross-process-task",
      projectDir: project,
      logPath: logFile,
      baudRate: 57600,
      environment: "fixture",
    });
    expect(query(other)).toMatchObject({ state: "inactive" });
    expect(
      ["", ".identities.json", ".metadata.json"].map((suffix) =>
        fs.readFileSync(registryPath + suffix, "utf8"),
      ),
    ).toEqual(before);
    await stopFixture(child);
    expect(query(project)).toMatchObject({ state: "stale" });
  } finally {
    await stopFixture(child);
    await fs.promises.rm(testRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}, 180000);
