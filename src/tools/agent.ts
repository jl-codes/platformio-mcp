/**
 * Agent-Oriented Workflow Tools
 *
 * Provides:
 * - agentValidateProject: Pre-flight project validation and readiness report.
 * - agentBuildDiagnose: Build execution with structured diagnostic classification.
 * - agentSafePinAudit: Heuristic GPIO safety audit for board-specific pin risks.
 * - agentFlashMonitorVerify: Flash + runtime serial verification workflow.
 * - agentGetLastReport: Retrieves the persisted last agent report.
 * - agentGenerateBoardReport: Builds and caches board intelligence metadata.
 */

import fs from "node:fs";
import path from "node:path";
import { listBoardsCore } from "../core/boards.js";
import { buildProjectCore } from "../core/build.js";
import { diagnoseBuildLog } from "../core/diagnostics/build-diagnostics.js";
import type { DiagnosticResult } from "../core/diagnostics/types.js";
import { diagnoseUploadLog } from "../core/diagnostics/upload-diagnostics.js";
import {
  evaluateRuntimeAssertions,
  type RuntimeAssertionResult,
} from "../core/runtime-assertions.js";
import { listDevicesCore } from "../core/devices.js";
import { uploadFirmwareCore } from "../core/flash.js";
import { getBoardProfile } from "../boards/index.js";
import { findFirmwareArtifact } from "../utils/build-cache.js";
import {
  readLastAgentReport,
  writeBoardReport,
  writeLastAgentReport,
} from "../utils/artifacts.js";
import { validateProjectPath } from "../utils/validation.js";
import { getBoardInfo } from "./boards.js";
import { getProjectConfig } from "./projects.js";
import type {
  AgentBoardReport,
  AgentBuildDiagnoseResult,
  AgentFlashMonitorVerifyResult,
  AgentGetLastReportResult,
  AgentPinAuditResult,
  AgentValidateProjectResult,
  LastAgentReport,
  PinAuditSeverity,
} from "../types.js";

type ParsedEnvironment = {
  name: string;
  board?: string;
  framework?: string;
};

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cpp",
  ".cc",
  ".cxx",
  ".h",
  ".hpp",
  ".hh",
  ".hxx",
  ".ino",
]);

const MAX_MONITOR_BYTES = 128 * 1024;

function severityRank(severity: PinAuditSeverity): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function parseDefaultEnvironments(iniText: string): string[] {
  const defaultMatch = iniText.match(/^\s*default_envs\s*=\s*(.+)$/im);
  if (!defaultMatch) return [];
  return defaultMatch[1]
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseEnvironmentsFromIni(iniText: string): ParsedEnvironment[] {
  const lines = iniText.split(/\r?\n/);
  const environments: ParsedEnvironment[] = [];
  let activeEnv: ParsedEnvironment | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;

    const sectionMatch = line.match(/^\[env:([^\]]+)\]$/i);
    if (sectionMatch) {
      activeEnv = { name: sectionMatch[1].trim() };
      environments.push(activeEnv);
      continue;
    }

    if (!activeEnv) continue;
    const kvMatch = line.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1].toLowerCase();
    const value = kvMatch[2].trim();

    if (key === "board") activeEnv.board = value;
    if (key === "framework") activeEnv.framework = value;
  }

  return environments;
}

function readProjectIniText(projectDir: string): string {
  const iniPath = path.join(projectDir, "platformio.ini");
  if (!fs.existsSync(iniPath)) return "";
  try {
    return fs.readFileSync(iniPath, "utf8");
  } catch {
    return "";
  }
}

function listSourceFiles(projectDir: string): string[] {
  const srcRoot = path.join(projectDir, "src");
  if (!fs.existsSync(srcRoot)) return [];

  const out: string[] = [];
  const stack = [srcRoot];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext)) continue;
      out.push(path.relative(projectDir, absPath).replace(/\\/g, "/"));
    }
  }

  return out.sort((a, b) => a.localeCompare(b));
}

function resolveEnvironment(boardEnvs: ParsedEnvironment[]): string | undefined {
  return boardEnvs[0]?.name;
}

function buildValidationNextSteps(
  hasPlatformioIni: boolean,
  environments: ParsedEnvironment[],
  sourceFiles: string[],
  missingConfigEntries: string[],
  hasDevices: boolean,
): string[] {
  const steps: string[] = [];

  if (!hasPlatformioIni) {
    steps.push("Create platformio.ini by running `init_project` for your board.");
    return steps;
  }

  if (environments.length === 0) {
    steps.push("Add at least one `[env:*]` section to platformio.ini before building.");
  }

  if (sourceFiles.length === 0) {
    steps.push("Add at least one source file under `src/` (for example `src/main.cpp`).");
  }

  if (missingConfigEntries.some((entry) => entry.includes("framework"))) {
    steps.push("Add `framework = <name>` to each environment missing framework.");
  }

  if (missingConfigEntries.some((entry) => entry.includes("board"))) {
    steps.push("Add `board = <board_id>` to each environment missing board.");
  }

  if (!hasDevices) {
    steps.push("Connect a serial device and rerun `list_devices` before flashing.");
  } else {
    steps.push("Run `agent_build_diagnose` next to validate the toolchain and firmware.");
  }

  if (steps.length === 0) {
    steps.push("Project looks healthy. Proceed with `agent_build_diagnose`.");
  }

  return steps;
}

function persistAgentReport(
  projectDir: string,
  tool: string,
  success: boolean,
  summary: string,
  payload: LastAgentReport["payload"],
): void {
  const report: LastAgentReport = {
    tool,
    timestamp: new Date().toISOString(),
    projectDir,
    success,
    summary,
    payload,
  };
  writeLastAgentReport(projectDir, report);
}

/**
 * Validates a PlatformIO project for agent readiness.
 *
 * @param projectDir - Path to the PlatformIO project directory.
 * @returns Structured project readiness report.
 */
export async function agentValidateProject(
  projectDir: string,
): Promise<AgentValidateProjectResult> {
  const validatedPath = validateProjectPath(projectDir);
  const iniPath = path.join(validatedPath, "platformio.ini");
  const hasPlatformioIni = fs.existsSync(iniPath);

  let iniText = "";
  if (hasPlatformioIni) {
    try {
      iniText = fs.readFileSync(iniPath, "utf8");
    } catch {
      iniText = "";
    }
  }

  const parsedEnvironments = parseEnvironmentsFromIni(iniText);
  const defaultFromIni = parseDefaultEnvironments(iniText);
  const defaultEnvironment =
    defaultFromIni[0] ?? resolveEnvironment(parsedEnvironments);
  const boardIds = Array.from(
    new Set(
      parsedEnvironments
        .map((env) => env.board)
        .filter((board): board is string => Boolean(board)),
    ),
  );
  const sourceFiles = listSourceFiles(validatedPath);
  const missingConfigEntries: string[] = [];

  for (const env of parsedEnvironments) {
    if (!env.board) {
      missingConfigEntries.push(
        `Environment '${env.name}' is missing required 'board' entry.`,
      );
    }
    if (!env.framework) {
      missingConfigEntries.push(
        `Environment '${env.name}' is missing required 'framework' entry.`,
      );
    }
  }

  let boardWarnings: string[] = [];
  if (boardIds.length > 0) {
    const checks = await Promise.all(
      boardIds.map(async (boardId) => {
        const matches = await listBoardsCore(boardId);
        return { boardId, known: matches.some((b) => b.id === boardId) };
      }),
    );
    boardWarnings = checks
      .filter((result) => !result.known)
      .map((result) => `Board ID '${result.boardId}' was not found in registry.`);
    missingConfigEntries.push(...boardWarnings);
  }

  // Leverage existing config retrieval path for a richer readiness signal.
  if (hasPlatformioIni) {
    try {
      await getProjectConfig(validatedPath);
    } catch {
      missingConfigEntries.push(
        "platformio.ini exists but `get_project_config` failed to parse it.",
      );
    }
  }

  const connectedDevices = await listDevicesCore();
  const nextSteps = buildValidationNextSteps(
    hasPlatformioIni,
    parsedEnvironments,
    sourceFiles,
    missingConfigEntries,
    connectedDevices.length > 0,
  );

  const success =
    hasPlatformioIni &&
    parsedEnvironments.length > 0 &&
    sourceFiles.length > 0 &&
    missingConfigEntries.length === 0;

  const result: AgentValidateProjectResult = {
    success,
    projectDir: validatedPath,
    hasPlatformioIni,
    environments: parsedEnvironments.map((env) => env.name),
    defaultEnvironment,
    boardIds,
    sourceFiles,
    missingConfigEntries,
    connectedDevices: connectedDevices.map((device) => ({
      port: device.port,
      description: device.description,
      detectedBoard: device.detectedBoard,
    })),
    nextSteps,
  };

  persistAgentReport(
    validatedPath,
    "agent_validate_project",
    success,
    success
      ? "Project validation passed."
      : "Project validation found readiness issues.",
    result,
  );

  return result;
}

function pickBuildDiagnostic(resultOutput: string | undefined, success: boolean): DiagnosticResult {
  return diagnoseBuildLog(resultOutput ?? "", { success });
}

/**
 * Builds a project and returns a rich diagnostic classification payload.
 *
 * @param projectDir - Path to the PlatformIO project directory.
 * @param environment - Optional environment name.
 * @param verbose - Optional verbose build flag.
 * @param background - Optional background dispatch flag.
 * @returns Structured build + diagnostics result.
 */
export async function agentBuildDiagnose(
  projectDir: string,
  environment?: string,
  verbose?: boolean,
  background?: boolean,
): Promise<AgentBuildDiagnoseResult> {
  const validatedPath = validateProjectPath(projectDir);
  const buildResult = await buildProjectCore({
    projectDir: validatedPath,
    environment,
    verbose,
    background,
  });

  if ("status" in buildResult && buildResult.status === "running") {
    const diagnostic = diagnoseBuildLog("", { success: false });
    const runningResult: AgentBuildDiagnoseResult = {
      success: false,
      projectDir: validatedPath,
      environment: environment ?? "default",
      diagnostic: {
        ...diagnostic,
        summary: "Build dispatched to background; diagnosis pending completion.",
        recommendedAction:
          "Poll `check_task_status` for the build task to obtain diagnostics.",
      },
      nextSteps: [
        "Poll `check_task_status` with the returned taskId until completion.",
      ],
    };
    persistAgentReport(
      validatedPath,
      "agent_build_diagnose",
      false,
      "Build dispatched to background; diagnostic report pending.",
      runningResult,
    );
    return runningResult;
  }

  const success = Boolean(buildResult.success);
  const diagnostic =
    buildResult.diagnostic ?? pickBuildDiagnostic(buildResult.output, success);
  const resolvedEnvironment =
    buildResult.environment ?? environment ?? "default";

  const result: AgentBuildDiagnoseResult = {
    success,
    projectDir: validatedPath,
    environment: resolvedEnvironment,
    cacheHit: buildResult.cacheHit,
    diagnostic,
    nextSteps:
      buildResult.nextSteps && buildResult.nextSteps.length > 0
        ? buildResult.nextSteps
        : [diagnostic.recommendedAction],
    ramUsageBytes: buildResult.ramUsageBytes,
    flashUsageBytes: buildResult.flashUsageBytes,
    firmwarePath: buildResult.firmwarePath,
    rawLogPath: buildResult.rawLogPath,
  };

  persistAgentReport(
    validatedPath,
    "agent_build_diagnose",
    success,
    success
      ? "Build completed with diagnostics and resource usage."
      : `Build failed with ${diagnostic.errorType ?? "Unknown"} diagnostic classification.`,
    result,
  );

  return result;
}

type PinUsage = {
  pin: number;
  operation: string;
  line: string;
};

function collectPinUsages(projectDir: string): PinUsage[] {
  const srcFiles = listSourceFiles(projectDir)
    .map((relPath) => path.join(projectDir, relPath))
    .filter((absPath) => fs.existsSync(absPath));

  const usages: PinUsage[] = [];
  const macroMap = new Map<string, number>();
  const defineRegex = /^\s*#define\s+([A-Za-z_][A-Za-z0-9_]*)\s+(\d{1,2})\b/gm;
  const callRegex =
    /\b(pinMode|digitalWrite|analogWrite|analogRead)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*|\d{1,2})/g;

  for (const absPath of srcFiles) {
    let text = "";
    try {
      text = fs.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }

    defineRegex.lastIndex = 0;
    for (const match of text.matchAll(defineRegex)) {
      macroMap.set(match[1], Number.parseInt(match[2], 10));
    }
  }

  for (const absPath of srcFiles) {
    let text = "";
    try {
      text = fs.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }

    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      callRegex.lastIndex = 0;
      for (const match of line.matchAll(callRegex)) {
        const operation = match[1];
        const token = match[2];
        const resolvedPin =
          /^[0-9]+$/.test(token) ? Number.parseInt(token, 10) : macroMap.get(token);
        if (resolvedPin === undefined || Number.isNaN(resolvedPin)) continue;
        usages.push({
          pin: resolvedPin,
          operation,
          line: line.trim(),
        });
      }
    }
  }

  return usages;
}

function evaluatePinUsageRisk(
  pinUsage: PinUsage,
  boardId: string,
): AgentPinAuditResult | null {
  const profile = getBoardProfile({ boardId });
  if (!profile) return null;

  const pin = pinUsage.pin;
  const { dangerousPins, inputOnlyPins, flashSpiPins, saferAlternatives } =
    profile.pinProfile;

  if (flashSpiPins.includes(pin)) {
    return {
      pin,
      severity: "high",
      reason: `GPIO${pin} is reserved for ESP32 flash/SPI lines and should not be used by application code.`,
      recommendation: "Move this signal to a general-purpose GPIO not used by flash.",
      saferAlternatives,
    };
  }

  if (dangerousPins.includes(pin)) {
    return {
      pin,
      severity: "high",
      reason: `GPIO${pin} is an ESP32 strapping/boot pin and may break boot or flash stability.`,
      recommendation:
        "Avoid strapping pins for user I/O. Reassign this signal to a safer GPIO.",
      saferAlternatives,
    };
  }

  if (inputOnlyPins.includes(pin)) {
    const outputOperation =
      pinUsage.operation === "digitalWrite" || pinUsage.operation === "analogWrite";
    if (outputOperation) {
      return {
        pin,
        severity: "high",
        reason: `GPIO${pin} is input-only on ESP32 but is used with ${pinUsage.operation}.`,
        recommendation:
          "Use an output-capable pin for this signal or refactor to input-only behavior.",
        saferAlternatives,
      };
    }

    return {
      pin,
      severity: "medium",
      reason: `GPIO${pin} is input-only on ESP32; verify this usage remains read-only.`,
      recommendation:
        "Keep this pin for read-only operations, or move to a general-purpose GPIO if output is needed.",
      saferAlternatives,
    };
  }

  return null;
}

/**
 * Performs a heuristic static pin audit against board profile rules.
 *
 * @param projectDir - Path to the PlatformIO project directory.
 * @param boardId - Target board ID for profile-based pin safety rules.
 * @returns Pin-risk findings discovered during static scan.
 */
export async function agentSafePinAudit(
  projectDir: string,
  boardId: string,
): Promise<AgentPinAuditResult[]> {
  const validatedPath = validateProjectPath(projectDir);
  const pinUsages = collectPinUsages(validatedPath);
  const byPin = new Map<number, AgentPinAuditResult>();

  for (const usage of pinUsages) {
    const finding = evaluatePinUsageRisk(usage, boardId);
    if (!finding) continue;

    const existing = byPin.get(usage.pin);
    if (!existing || severityRank(finding.severity) > severityRank(existing.severity)) {
      byPin.set(usage.pin, finding);
    }
  }

  const findings = Array.from(byPin.values()).sort((a, b) => {
    const rankDiff = severityRank(b.severity) - severityRank(a.severity);
    if (rankDiff !== 0) return rankDiff;
    return String(a.pin).localeCompare(String(b.pin));
  });

  persistAgentReport(
    validatedPath,
    "agent_safe_pin_audit",
    findings.length === 0,
    findings.length === 0
      ? "No high-risk GPIO usage patterns were found by heuristic pin scan."
      : `Pin audit found ${findings.length} potential GPIO safety issues.`,
    findings,
  );

  return findings;
}

function summarizeRuntimeOutcome(
  assertions: RuntimeAssertionResult,
): { status: AgentFlashMonitorVerifyResult["verificationStatus"]; action: string } {
  if (assertions.rejectedPatterns.length > 0) {
    return {
      status: "failed",
      action:
        "Remove rejected runtime failures and reflash after fixing the first failing runtime symptom.",
    };
  }

  if (assertions.runtimeFailures.some((item) => item !== "NoSerialOutput")) {
    return {
      status: "failed",
      action:
        "Inspect the runtime failure signature (brownout/watchdog/panic/boot loop) and patch hardware or firmware accordingly.",
    };
  }

  if (assertions.runtimeFailures.includes("NoSerialOutput")) {
    return {
      status: "failed",
      action:
        "No serial output observed. Verify baud rate, wiring, and boot logging markers before retrying.",
    };
  }

  if (assertions.unmatchedExpectations.length > 0) {
    return {
      status: "failed",
      action:
        "Expected boot markers were not observed. Confirm firmware prints expected strings and retry verification.",
    };
  }

  if (!assertions.stabilityAchieved) {
    return {
      status: "inconclusive",
      action:
        "Runtime output did not reach the requested stability window; increase timeout or reduce boot noise.",
    };
  }

  return {
    status: "passed",
    action: "Verification passed. Proceed to the next integration or test step.",
  };
}

async function collectMonitorTail(
  logPath: string,
  timeoutSeconds: number,
): Promise<{ output: string; secondsSinceLastOutput: number; monitorSuccess: boolean }> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastSeenAt = Date.now();
  let lastKnownLength = 0;
  let captured = "";
  let monitorSuccess = false;

  while (Date.now() < deadline) {
    if (fs.existsSync(logPath)) {
      monitorSuccess = true;
      try {
        const content = fs.readFileSync(logPath, "utf8");
        if (content.length < lastKnownLength) {
          // Log rotated; reset offset.
          lastKnownLength = 0;
        }
        if (content.length > lastKnownLength) {
          const chunk = content.slice(lastKnownLength);
          captured += chunk;
          if (captured.length > MAX_MONITOR_BYTES) {
            captured = captured.slice(-MAX_MONITOR_BYTES);
          }
          lastKnownLength = content.length;
          lastSeenAt = Date.now();
        }
      } catch {
        // Keep polling until timeout.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return {
    output: captured,
    secondsSinceLastOutput: (Date.now() - lastSeenAt) / 1000,
    monitorSuccess,
  };
}

function inferBoardIdForProject(
  projectDir: string,
  requestedEnvironment?: string,
): string | undefined {
  const iniText = readProjectIniText(projectDir);
  if (!iniText) return undefined;
  const envs = parseEnvironmentsFromIni(iniText);

  if (requestedEnvironment?.trim()) {
    const targeted = envs.find(
      (env) => env.name === requestedEnvironment.trim() && env.board,
    );
    if (targeted?.board) return targeted.board;
  }

  const defaults = parseDefaultEnvironments(iniText);

  if (defaults.length > 0) {
    for (const defaultEnv of defaults) {
      const matched = envs.find((env) => env.name === defaultEnv && env.board);
      if (matched?.board) return matched.board;
    }
  }

  return envs.find((env) => Boolean(env.board))?.board;
}

function inferArtifactTargetEnvironments(
  projectDir: string,
  requestedEnvironment?: string,
): string[] {
  if (requestedEnvironment?.trim()) {
    return [requestedEnvironment.trim()];
  }

  const iniText = readProjectIniText(projectDir);
  if (!iniText) return [];

  const envs = parseEnvironmentsFromIni(iniText);
  const defaults = parseDefaultEnvironments(iniText);
  if (defaults.length > 0) {
    return Array.from(new Set(defaults));
  }

  // Without default_envs, PlatformIO can process multiple environments.
  // In this ambiguous case we only skip pre-build if exactly one env exists.
  if (envs.length === 1) {
    return [envs[0].name];
  }

  return [];
}

function hasResolvedFirmwareArtifacts(
  projectDir: string,
  targetEnvironments: string[],
): boolean {
  if (targetEnvironments.length === 0) return false;
  return targetEnvironments.every((envName) =>
    Boolean(findFirmwareArtifact(projectDir, envName)),
  );
}

/**
 * Builds (if needed), flashes, monitors, and verifies runtime behavior.
 *
 * @param input - Flash + monitor verification options.
 * @returns Structured flash and runtime verification report.
 */
export async function agentFlashMonitorVerify(input: {
  projectDir: string;
  environment?: string;
  port?: string;
  expectAll?: string[];
  rejectPatterns?: string[];
  timeoutSeconds?: number;
  stabilityWindowSeconds?: number;
  autoBuild?: boolean;
}): Promise<AgentFlashMonitorVerifyResult> {
  const validatedPath = validateProjectPath(input.projectDir);
  const timeoutSeconds = input.timeoutSeconds ?? 45;
  const stabilityWindowSeconds = input.stabilityWindowSeconds ?? 10;
  const expectAll = input.expectAll ?? [];
  const rejectPatterns = input.rejectPatterns ?? [];
  const environment = input.environment ?? "default";
  const shouldAutoBuild = input.autoBuild ?? true;

  if (shouldAutoBuild) {
    const targetEnvironments = inferArtifactTargetEnvironments(
      validatedPath,
      input.environment,
    );
    const hasArtifacts = hasResolvedFirmwareArtifacts(
      validatedPath,
      targetEnvironments,
    );

    if (!hasArtifacts) {
      const build = await buildProjectCore({
        projectDir: validatedPath,
        environment: input.environment,
      });

      if ("status" in build && build.status === "running") {
        const queuedBuildResult: AgentFlashMonitorVerifyResult = {
          success: false,
          projectDir: validatedPath,
          environment,
          flashSuccess: false,
          monitorSuccess: false,
          verificationStatus: "inconclusive",
          matchedExpectations: [],
          unmatchedExpectations: expectAll,
          rejectedPatterns: [],
          detectedRuntimeErrors: [],
          recommendedNextAction:
            "Pre-flash build is running in the background. Poll `check_task_status`, then rerun verification.",
        };
        persistAgentReport(
          validatedPath,
          "agent_flash_monitor_verify",
          false,
          "Pre-flash build dispatched to background; verification deferred.",
          queuedBuildResult,
        );
        return queuedBuildResult;
      }

      if (!("status" in build) && !build.success) {
        const diagnostic =
          build.diagnostic ??
          diagnoseBuildLog(build.output ?? "", { success: false, rawLogPath: build.rawLogPath });
        const failedResult: AgentFlashMonitorVerifyResult = {
          success: false,
          projectDir: validatedPath,
          environment,
          flashSuccess: false,
          monitorSuccess: false,
          verificationStatus: "flash_failed",
          matchedExpectations: [],
          unmatchedExpectations: expectAll,
          rejectedPatterns: [],
          detectedRuntimeErrors: [],
          diagnostic,
          recommendedNextAction: diagnostic.recommendedAction,
        };
        persistAgentReport(
          validatedPath,
          "agent_flash_monitor_verify",
          false,
          "Pre-flash build failed; flash workflow aborted.",
          failedResult,
        );
        return failedResult;
      }
    }
  }

  const uploadResult = await uploadFirmwareCore({
    projectDir: validatedPath,
    port: input.port,
    environment: input.environment,
    startMonitorAfter: true,
    verbose: true,
  });

  if ("status" in uploadResult && uploadResult.status === "running") {
    const queuedResult: AgentFlashMonitorVerifyResult = {
      success: false,
      projectDir: validatedPath,
      environment,
      flashSuccess: false,
      monitorSuccess: false,
      verificationStatus: "inconclusive",
      matchedExpectations: [],
      unmatchedExpectations: expectAll,
      rejectedPatterns: [],
      detectedRuntimeErrors: [],
      recommendedNextAction:
        "Upload dispatched to background. Poll `check_task_status` and rerun verification when complete.",
    };
    persistAgentReport(
      validatedPath,
      "agent_flash_monitor_verify",
      false,
      "Upload dispatched to background; runtime verification pending.",
      queuedResult,
    );
    return queuedResult;
  }

  const uploadSuccess = Boolean(uploadResult.success);
  const uploadDiagnostic: DiagnosticResult | undefined = uploadResult.diagnostic;
  if (!uploadSuccess) {
    const baselineDiagnostic =
      uploadDiagnostic ??
      diagnoseUploadLog(uploadResult.output ?? "", {
        success: false,
        rawLogPath: uploadResult.rawLogPath,
      });

    let finalDiagnostic = baselineDiagnostic;
    const projectBoardId = inferBoardIdForProject(
      validatedPath,
      input.environment,
    );
    if (projectBoardId) {
      const findings = await agentSafePinAudit(validatedPath, projectBoardId);
      const riskyPin = findings.find((item) => item.severity === "high");
      if (riskyPin) {
        finalDiagnostic = {
          ...baselineDiagnostic,
          errorType: "Esp32StrappingPinRisk",
          summary: "upload failed with potential ESP32 strapping pin risk.",
          recommendedAction: riskyPin.recommendation,
          safeToAutoRetry: false,
          evidence: baselineDiagnostic.evidence.concat(
            `Pin audit flagged GPIO${riskyPin.pin} as high risk.`,
          ),
        };
      }
    }

    const failedResult: AgentFlashMonitorVerifyResult = {
      success: false,
      projectDir: validatedPath,
      environment,
      flashSuccess: false,
      monitorSuccess: false,
      verificationStatus: "flash_failed",
      matchedExpectations: [],
      unmatchedExpectations: expectAll,
      rejectedPatterns: [],
      detectedRuntimeErrors: [],
      diagnostic: finalDiagnostic,
      recommendedNextAction: finalDiagnostic.recommendedAction,
      rawMonitorLogPath: undefined,
    };
    persistAgentReport(
      validatedPath,
      "agent_flash_monitor_verify",
      false,
      "Firmware upload failed before runtime verification.",
      failedResult,
    );
    return failedResult;
  }

  const monitorLogPath = path.join(
    validatedPath,
    ".pio-mcp-workspace",
    "logs",
    "monitor",
    "latest-monitor.log",
  );
  const monitorCollection = await collectMonitorTail(monitorLogPath, timeoutSeconds);
  const assertions = evaluateRuntimeAssertions({
    serialOutput: monitorCollection.output,
    expectAll,
    rejectPatterns,
    stabilityWindowSeconds,
    secondsSinceLastOutput: monitorCollection.secondsSinceLastOutput,
  });
  const runtimeSummary = summarizeRuntimeOutcome(assertions);

  const result: AgentFlashMonitorVerifyResult = {
    success: runtimeSummary.status === "passed",
    projectDir: validatedPath,
    environment,
    flashSuccess: true,
    monitorSuccess: monitorCollection.monitorSuccess,
    verificationStatus: runtimeSummary.status,
    matchedExpectations: assertions.matchedExpectations,
    unmatchedExpectations: assertions.unmatchedExpectations,
    rejectedPatterns: assertions.rejectedPatterns,
    detectedRuntimeErrors: assertions.runtimeFailures,
    diagnostic: uploadDiagnostic,
    recommendedNextAction: runtimeSummary.action,
    rawMonitorLogPath: monitorCollection.monitorSuccess ? monitorLogPath : undefined,
    monitorSnippet: monitorCollection.output.slice(-2000),
  };

  persistAgentReport(
    validatedPath,
    "agent_flash_monitor_verify",
    result.success,
    result.success
      ? "Flash and runtime verification succeeded."
      : `Flash succeeded but runtime verification ended with status '${result.verificationStatus}'.`,
    result,
  );

  return result;
}

/**
 * Retrieves the most recently persisted agent report.
 *
 * @param projectDir - Path to the PlatformIO project directory.
 * @returns Last report payload or a missing-report descriptor.
 */
export async function agentGetLastReport(
  projectDir: string,
): Promise<AgentGetLastReportResult> {
  const validatedPath = validateProjectPath(projectDir);
  const report = readLastAgentReport(validatedPath);
  if (!report) {
    return {
      success: false,
      message:
        "No persisted agent report found. Run an agent workflow first (for example `agent_build_diagnose`).",
    };
  }

  return {
    success: true,
    report,
  };
}

/**
 * Generates and caches a board intelligence report.
 *
 * @param projectDir - Path to the PlatformIO project directory.
 * @param boardId - Target PlatformIO board ID.
 * @returns Board intelligence report payload.
 */
export async function agentGenerateBoardReport(
  projectDir: string,
  boardId: string,
): Promise<AgentBoardReport> {
  const validatedPath = validateProjectPath(projectDir);
  const boardInfo = await getBoardInfo(boardId);
  const profile = getBoardProfile({
    boardId: boardInfo.id,
    platform: boardInfo.platform,
    mcu: boardInfo.mcu,
  });

  const report: AgentBoardReport = {
    boardId: boardInfo.id,
    platform: boardInfo.platform,
    frameworks: boardInfo.frameworks ?? [],
    mcu: boardInfo.mcu,
    flashBytes: boardInfo.flash,
    ramBytes: boardInfo.ram,
    dangerousPins: profile?.pinProfile.dangerousPins ?? [],
    inputOnlyPins: profile?.pinProfile.inputOnlyPins ?? [],
    flashSpiPins: profile?.pinProfile.flashSpiPins ?? [],
    recommendedMonitorBaudRate: profile?.defaultMonitorBaudRate ?? 115200,
    generatedAt: new Date().toISOString(),
  };

  writeBoardReport(validatedPath, report);
  persistAgentReport(
    validatedPath,
    "agent_generate_board_report",
    true,
    `Generated board report for '${boardInfo.id}'.`,
    report,
  );
  return report;
}
