/**
 * Runs one explicitly approved physical-board acceptance flow through the CLI.
 *
 * The workflow is intentionally narrow: resolve, build, flash, re-resolve,
 * capture one bounded health window, and prove no tracked task remains running.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/**
 * Resolves a fixture project while preventing workflow input from escaping the checkout.
 * @param {string} repoRoot Repository checkout root.
 * @param {string} projectInput User-selected project path relative to the checkout.
 * @returns {string} Validated absolute PlatformIO project path.
 */
export function resolveHardwareProject(repoRoot, projectInput) {
  if (!projectInput || path.isAbsolute(projectInput)) {
    throw new Error(
      "PIO_HIL_PROJECT_DIR must be a non-empty checkout-relative path.",
    );
  }
  const resolvedRoot = path.resolve(repoRoot);
  const projectDir = path.resolve(resolvedRoot, projectInput);
  const relativePath = path.relative(resolvedRoot, projectDir);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      "Hardware fixture must stay inside the repository checkout.",
    );
  }
  if (!fs.existsSync(path.join(projectDir, "platformio.ini"))) {
    throw new Error(
      `PlatformIO fixture is missing platformio.ini: ${relativePath}`,
    );
  }
  return projectDir;
}

/**
 * Runs one CLI command without a shell and parses its JSON result.
 * @param {string[]} args CLI arguments excluding the executable.
 * @param {{ repoRoot: string, timeoutMs?: number }} options Spawn options.
 * @returns {unknown} Parsed CLI result.
 */
export function runCliJson(args, options) {
  const result = spawnSync(
    process.execPath,
    [path.join(options.repoRoot, "build", "cli.js"), ...args, "--json"],
    {
      cwd: options.repoRoot,
      env: { ...process.env, PIO_MCP_NO_BROWSER: "true" },
      encoding: "utf8",
      maxBuffer: MAX_OUTPUT_BYTES,
      shell: false,
      windowsHide: true,
      timeout: options.timeoutMs ?? 10 * 60 * 1000,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "")
      .slice(-8192)
      .trim();
    const stdout = String(result.stdout ?? "")
      .slice(-8192)
      .trim();
    throw new Error(
      `CLI command '${args[0]}' failed with status ${result.status}: ${stderr || stdout || "no diagnostic output"}`,
    );
  }
  try {
    return JSON.parse(String(result.stdout).trim());
  } catch {
    throw new Error(`CLI command '${args[0]}' did not return valid JSON.`);
  }
}

/**
 * Executes the physical acceptance sequence using an injectable command runner.
 * @param {{ repoRoot: string, projectDir: string, projectLabel: string, environment: string, port: string, expectedMarker: string, boardFamily: string, captureDurationSeconds: number }} config Exact hardware scope.
 * @param {(args: string[], options: { repoRoot: string, timeoutMs?: number }) => unknown} [runCommand] Command runner used by tests and the workflow.
 * @param {(milliseconds: number) => Promise<void>} [delay] Retry delay used by tests and the workflow.
 * @returns {Promise<Record<string, unknown>>} Bounded acceptance evidence.
 */
export async function runHardwareAcceptance(
  config,
  runCommand = runCliJson,
  delay = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  const invoke = (args, timeoutMs) =>
    /** @type {Record<string, any>} */ (
      runCommand(args, { repoRoot: config.repoRoot, timeoutMs })
    );
  const startedAt = new Date().toISOString();
  const commonTargetArgs = [
    "--project-dir",
    config.projectDir,
    "--environment",
    config.environment,
  ];

  const initialTarget = invoke([
    "target-resolve",
    ...commonTargetArgs,
    "--port",
    config.port,
  ]);
  if (!initialTarget.success || !initialTarget.binding?.deviceFingerprint) {
    throw new Error(
      `Initial target resolution failed: ${initialTarget.summary ?? initialTarget.status ?? "unknown target error"}`,
    );
  }

  const build = invoke(["build", ...commonTargetArgs], 10 * 60 * 1000);
  if (!build.success)
    throw new Error("Hardware fixture build did not succeed.");

  const flash = invoke(
    ["flash", ...commonTargetArgs, "--port", config.port, "--approve"],
    5 * 60 * 1000,
  );
  if (!flash.success)
    throw new Error("Explicitly approved firmware upload failed.");

  let finalTarget;
  let reattachAttempts = 0;
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    reattachAttempts = attempt;
    finalTarget = invoke(["target-resolve", ...commonTargetArgs]);
    if (finalTarget.success || finalTarget.status !== "unavailable") break;
    await delay(1000);
  }
  if (!finalTarget.success || !finalTarget.binding?.deviceFingerprint) {
    throw new Error(
      `Post-flash target resolution failed: ${finalTarget.summary ?? finalTarget.status ?? "unknown target error"}`,
    );
  }
  if (
    finalTarget.binding.deviceFingerprint !==
    initialTarget.binding.deviceFingerprint
  ) {
    throw new Error(
      "The attached device identity changed after flashing; runtime monitoring was stopped.",
    );
  }

  const monitorHealth = invoke(
    [
      "monitor-health",
      ...commonTargetArgs,
      "--duration",
      String(config.captureDurationSeconds),
      "--expect-all",
      config.expectedMarker,
    ],
    (config.captureDurationSeconds + 60) * 1000,
  );
  if (!monitorHealth.success) {
    throw new Error(
      `Runtime health assertion failed: ${monitorHealth.health?.summary ?? "unknown monitor failure"}`,
    );
  }

  const history = invoke([
    "task-history",
    "--project-dir",
    config.projectDir,
    "--limit",
    "100",
  ]);
  const runningTasks = Array.isArray(history.tasks)
    ? history.tasks.filter((task) => task?.status === "running")
    : [];
  if (runningTasks.length > 0) {
    throw new Error(
      `${runningTasks.length} tracked task(s) remained running after acceptance.`,
    );
  }

  return {
    schemaVersion: 1,
    success: true,
    startedAt,
    completedAt: new Date().toISOString(),
    boardFamily: config.boardFamily,
    project: config.projectLabel,
    environment: config.environment,
    initialPort: initialTarget.port,
    finalPort: finalTarget.port,
    portReenumerated: initialTarget.port !== finalTarget.port,
    reattachAttempts,
    deviceFingerprint: finalTarget.binding.deviceFingerprint,
    targetBindingDigest: finalTarget.binding.digest,
    build: { success: true, taskId: build.taskId },
    flash: { success: true, taskId: flash.taskId },
    monitor: {
      success: true,
      status: monitorHealth.health?.status,
      digest: monitorHealth.health?.digest,
      expectedMarker: config.expectedMarker,
    },
    cleanup: { runningTasks: 0 },
  };
}

function readRequiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function writeEvidence(projectDir, evidence) {
  const auditDir = path.join(projectDir, ".pio-mcp-workspace", "audit");
  fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(
    path.join(auditDir, "hardware-acceptance.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
}

async function main() {
  if (process.env.PIO_HIL_CONFIRM_WRITE !== "true") {
    throw new Error(
      "Physical firmware upload requires PIO_HIL_CONFIRM_WRITE=true from an explicit workflow dispatch.",
    );
  }
  const repoRoot = path.resolve(process.cwd());
  const projectInput = readRequiredEnvironment("PIO_HIL_PROJECT_DIR");
  const projectDir = resolveHardwareProject(repoRoot, projectInput);
  const captureDurationSeconds = Number(
    process.env.PIO_HIL_CAPTURE_DURATION_SECONDS ?? "10",
  );
  if (
    !Number.isInteger(captureDurationSeconds) ||
    captureDurationSeconds < 1 ||
    captureDurationSeconds > 60
  ) {
    throw new Error(
      "PIO_HIL_CAPTURE_DURATION_SECONDS must be an integer from 1 to 60.",
    );
  }
  const config = {
    repoRoot,
    projectDir,
    projectLabel: projectInput.replaceAll("\\", "/"),
    environment: readRequiredEnvironment("PIO_HIL_ENVIRONMENT"),
    port: readRequiredEnvironment("PIO_HIL_PORT"),
    expectedMarker: readRequiredEnvironment("PIO_HIL_EXPECTED_MARKER"),
    boardFamily: readRequiredEnvironment("PIO_HIL_BOARD_FAMILY"),
    captureDurationSeconds,
  };

  try {
    const evidence = await runHardwareAcceptance(config);
    writeEvidence(projectDir, evidence);
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    const evidence = {
      schemaVersion: 1,
      success: false,
      completedAt: new Date().toISOString(),
      boardFamily: config.boardFamily,
      project: config.projectLabel,
      environment: config.environment,
      error: error instanceof Error ? error.message : String(error),
    };
    writeEvidence(projectDir, evidence);
    console.error(JSON.stringify(evidence, null, 2));
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
