#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { PlatformIOError } from "./utils/errors.js";
import {
  AgentBuildDiagnoseParamsSchema,
  AgentFlashMonitorVerifyParamsSchema,
  AgentGenerateBoardReportParamsSchema,
  AgentGetLastReportParamsSchema,
  AgentMonitorHealthParamsSchema,
  AgentResolveTargetParamsSchema,
  AgentSafePinAuditParamsSchema,
  AgentValidateProjectParamsSchema,
  BuildProjectParamsSchema,
  CheckTaskStatusParamsSchema,
  GetApprovalRequestParamsSchema,
  GetPolicyStatusParamsSchema,
  GetDashboardUrlParamsSchema,
  GetMonitorStatusParamsSchema,
  InitProjectParamsSchema,
  ListBoardsParamsSchema,
  ListPendingApprovalsParamsSchema,
  ListTaskHistoryParamsSchema,
  StartMonitorParamsSchema,
  UploadFirmwareParamsSchema,
} from "./types.js";
import { listDevicesCore } from "./core/devices.js";
import { listBoardsCore } from "./core/boards.js";
import { initProjectCore } from "./core/project.js";
import { buildProjectCore } from "./core/build.js";
import { uploadFirmwareCore } from "./core/flash.js";
import {
  startMonitorCore,
  waitForExpectedSerialOutput,
} from "./core/monitor.js";
import {
  checkTaskStatusSummaryCore,
  listTaskHistoryCore,
} from "./core/tasks.js";
import { resolveTarget } from "./core/target-resolution.js";
import { getDashboardStatusCore } from "./core/dashboard.js";
import { toCliStructuredError } from "./core/cli-diagnostics.js";
import { evaluatePolicy } from "./core/policy/evaluate-policy.js";
import { getPolicyStatus } from "./core/policy/status.js";
import {
  approveRequest,
  denyRequest,
  getApproval,
  getApprovalRequestSummary,
  listApprovalRequests,
  listPendingApprovalSummaries,
} from "./core/policy/approvals.js";
import {
  agentBuildDiagnose,
  agentFlashMonitorVerify,
  agentGenerateBoardReport,
  agentGetLastReport,
  agentMonitorHealth,
  agentSafePinAudit,
  agentValidateProject,
} from "./tools/agent.js";
import { getMonitorStatus } from "./tools/monitor.js";

type OptionValue = string | boolean;
type ParsedArgs = {
  options: Record<string, OptionValue>;
  positionals: string[];
};

function printCliHelp() {
  console.log(`platformio-mcp / pio-agent

USAGE:
  pio-agent <command> [options]
  platformio-mcp <command> [options]

COMMANDS:
  devices
  boards --filter <value>
  init --board <id> --project-dir <dir> [--framework <name>]
  build --project-dir <dir> [--environment <env>] [--background] [--verbose]
  flash --project-dir <dir> [--port <port|auto>] [--environment <env>] [--background] [--start-monitor]
  monitor [--project-dir <dir>] [--port <port|auto>] [--environment <env>] [--timeout <seconds>] [--expect <text>] [--background]
  target-resolve --project-dir <dir> [--environment <env>] [--port <port>] [--binding-ttl <seconds>]
  monitor-status [--project-dir <dir>] [--port <port>]
  monitor-health --project-dir <dir> [--environment <env>] [--port <port>] [--duration <seconds>] [--expect-all <csv>] [--reject-patterns <csv>]
  task-status <task-id>
  task-history --project-dir <dir> [--status <status>] [--limit <n>]
  agent-validate --project-dir <dir>
  agent-build-diagnose --project-dir <dir> [--environment <env>] [--verbose]
  agent-safe-pin-audit --project-dir <dir> --board <id>
  agent-flash-monitor-verify --project-dir <dir> [--environment <env>] [--port <port|auto>] [--expect-all <csv>] [--reject-patterns <csv>] [--timeout <seconds>] [--stability-window <seconds>] [--auto-build <true|false>]
  agent-last-report --project-dir <dir>
  agent-board-report --project-dir <dir> --board <id>
  policy-status [--project-dir <dir>]
  approvals [--status <pending|approved|denied|expired>] [--limit <n>]
  approval-status <approval-id> [--project-dir <dir>]
  pending-approvals [--project-dir <dir>] [--limit <n>]
  approve <approval-id>
  deny <approval-id>
  dashboard
  install --<cline|claude|vscode|antigravity|codex|codex-plugin>
  plugin validate [--require-runtime]

GLOBAL FLAGS:
  --json
  --approve
  --help
  --version

SERVER MODE:
  Running with no command starts MCP stdio server (legacy behavior).
`);
}

function parseArgs(args: string[]): ParsedArgs {
  const options: Record<string, OptionValue> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const pair = token.slice(2);
    if (!pair) continue;

    const eqIndex = pair.indexOf("=");
    if (eqIndex >= 0) {
      const key = pair.slice(0, eqIndex);
      const value = pair.slice(eqIndex + 1);
      options[key] = value;
      continue;
    }

    const key = pair;
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      i++;
    } else {
      options[key] = true;
    }
  }

  return { options, positionals };
}

function asString(value: OptionValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: OptionValue | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return undefined;
}

function asNumber(value: OptionValue | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asCsv(value: OptionValue | undefined): string[] | undefined {
  if (typeof value !== "string") return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function normalizePortOption(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.toLowerCase() === "auto") return undefined;
  return value;
}

function printHuman(data: unknown) {
  if (typeof data === "string") {
    console.log(data);
    return;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log("No results.");
      return;
    }
    for (const item of data) {
      console.log(JSON.stringify(item, null, 2));
    }
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

function printOutput(data: unknown, jsonMode: boolean) {
  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  printHuman(data);
}

function actionForCommand(command: string): string {
  switch (command) {
    case "devices":
      return "list_devices";
    case "boards":
      return "list_boards";
    case "init":
      return "init_project";
    case "build":
      return "build_project";
    case "flash":
      return "upload_firmware";
    case "monitor":
      return "start_monitor";
    case "target-resolve":
      return "agent_resolve_target";
    case "monitor-status":
      return "get_monitor_status";
    case "monitor-health":
      return "agent_monitor_health";
    case "task-status":
      return "check_task_status";
    case "task-history":
      return "list_task_history";
    case "agent-validate":
      return "agent_validate_project";
    case "agent-build-diagnose":
      return "agent_build_diagnose";
    case "agent-safe-pin-audit":
      return "agent_safe_pin_audit";
    case "agent-flash-monitor-verify":
      return "upload_firmware";
    case "agent-last-report":
      return "agent_get_last_report";
    case "agent-board-report":
      return "agent_generate_board_report";
    case "policy-status":
      return "get_policy_status";
    case "dashboard":
      return "get_dashboard_url";
    case "plugin":
      return "get_policy_status";
    case "install":
      return "run_shell_command";
    case "approval-status":
      return "get_approval_request";
    case "pending-approvals":
      return "list_pending_approvals";
    case "approvals":
    case "approve":
    case "deny":
      return "query_logs";
    default:
      return command;
  }
}

async function promptApproval(reason: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      `Policy: approval required\nReason: ${reason}\nApprove? [y/N] `,
    );
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}

function readVersion(): string {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      fs.readFileSync(path.join(currentDir, "..", "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function runInstallSubcommand(rawArgs: string[]) {
  const target = rawArgs.find((a) => a.startsWith("--"))?.replace(/^--/, "");
  if (!target) {
    throw new Error("Usage: install --<cline|claude|vscode|antigravity|codex>");
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const installerEntry = path.join(
    currentDir,
    "..",
    "scripts",
    "installers",
    "index.js",
  );
  const installerUrl = pathToFileURL(installerEntry).href;
  const { runInstaller } = (await import(installerUrl)) as {
    runInstaller: (targetName: string) => Promise<void>;
  };
  await runInstaller(target);
}

async function runPluginSubcommand(rawArgs: string[]) {
  const { options, positionals } = parseArgs(rawArgs);
  if (positionals[0] !== "validate" || positionals.length !== 1) {
    throw new Error("Usage: plugin validate [--require-runtime]");
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const validatorEntry = path.join(
    currentDir,
    "..",
    "scripts",
    "validate-codex-plugin.mjs",
  );
  const validatorUrl = pathToFileURL(validatorEntry).href;
  const { validateCodexPlugin } = (await import(validatorUrl)) as {
    validateCodexPlugin: (options?: { requireRuntime?: boolean }) => {
      skills: number;
      runtimePresent: boolean;
    };
  };
  return validateCodexPlugin({
    requireRuntime: asBoolean(options["require-runtime"]) ?? false,
  });
}

async function runCliCommand(command: string, rawArgs: string[]) {
  const { options, positionals } = parseArgs(rawArgs);
  const jsonMode = Boolean(options.json);
  const actionName = actionForCommand(command);
  const projectDirForPolicy = asString(options["project-dir"]);
  const approvalOpt = asBoolean(options.approve);
  let policyArgs: Record<string, unknown> = {
    ...options,
    projectDir: projectDirForPolicy,
  };

  if (approvalOpt === true) {
    policyArgs = { ...policyArgs, __approved: true };
  }

  try {
    let decision = await evaluatePolicy(actionName, policyArgs, {
      workspaceDir: projectDirForPolicy,
      actor: "user",
    });

    if (decision.status === "deny") {
      const policyError = new PlatformIOError(
        decision.reason,
        "POLICY_DENIED",
        { policyDecision: decision },
      );
      throw policyError;
    }

    if (decision.status === "requires_approval") {
      if (jsonMode && approvalOpt !== true) {
        const policyError = new PlatformIOError(
          decision.reason,
          "APPROVAL_REQUIRED",
          { policyDecision: decision },
        );
        throw policyError;
      }

      if (approvalOpt !== true) {
        const approved = await promptApproval(decision.reason);
        if (!approved) {
          const policyError = new PlatformIOError(
            "Action cancelled by user.",
            "APPROVAL_DENIED",
            { policyDecision: decision },
          );
          throw policyError;
        }
      }

      policyArgs = {
        ...policyArgs,
        __approved: true,
        approvalId: decision.approvalId,
      };
      decision = await evaluatePolicy(actionName, policyArgs, {
        workspaceDir: projectDirForPolicy,
        actor: "user",
      });
      if (decision.status !== "allow") {
        const policyError = new PlatformIOError(
          decision.reason,
          "POLICY_DENIED",
          { policyDecision: decision },
        );
        throw policyError;
      }
    }

    switch (command) {
      case "devices": {
        const result = await listDevicesCore();
        printOutput(result, jsonMode);
        return;
      }

      case "boards": {
        const params = ListBoardsParamsSchema.parse({
          filter: asString(options.filter),
        });
        const result = await listBoardsCore(params.filter);
        printOutput(result, jsonMode);
        return;
      }

      case "init": {
        const params = InitProjectParamsSchema.parse({
          board: asString(options.board),
          framework: asString(options.framework),
          projectDir: asString(options["project-dir"]),
        });
        const result = await initProjectCore(params);
        printOutput(result, jsonMode);
        return;
      }

      case "build": {
        const params = BuildProjectParamsSchema.parse({
          projectDir: asString(options["project-dir"]),
          environment: asString(options.environment),
          verbose: asBoolean(options.verbose),
          background: asBoolean(options.background),
        });
        const result = await buildProjectCore(params);
        printOutput(result, jsonMode);
        return;
      }

      case "flash": {
        const params = UploadFirmwareParamsSchema.parse({
          projectDir: asString(options["project-dir"]),
          port: normalizePortOption(asString(options.port)),
          environment: asString(options.environment),
          verbose: asBoolean(options.verbose),
          background: asBoolean(options.background),
          start_monitor: asBoolean(options["start-monitor"]),
        });
        const result = await uploadFirmwareCore({
          projectDir: params.projectDir,
          port: params.port,
          environment: params.environment,
          verbose: params.verbose,
          background: params.background,
          startMonitorAfter: asBoolean(options["start-monitor"]),
        });
        printOutput(result, jsonMode);
        return;
      }

      case "monitor": {
        const timeoutSeconds = asNumber(options.timeout) ?? 30;
        const expect = asString(options.expect);
        const background = asBoolean(options.background) ?? false;

        const params = StartMonitorParamsSchema.parse({
          port: normalizePortOption(asString(options.port)),
          projectDir: asString(options["project-dir"]),
          environment: asString(options.environment),
        });

        const startResult = await startMonitorCore({
          port: params.port,
          projectDir: params.projectDir,
          environment: params.environment,
        });

        if (!expect || background) {
          printOutput(
            {
              ...startResult,
              expectation:
                expect && background
                  ? {
                      skipped: true,
                      reason:
                        "--expect was ignored because monitor was started in background mode.",
                    }
                  : undefined,
            },
            jsonMode,
          );
          return;
        }

        const expectation = await waitForExpectedSerialOutput({
          logFile: startResult.logFile,
          expect,
          timeoutSeconds,
        });

        if (!expectation.matched) {
          throw new PlatformIOError(
            `Expected serial output '${expect}' was not observed within ${timeoutSeconds}s.`,
            "EXPECTATION_TIMEOUT",
          );
        }

        printOutput(
          {
            ...startResult,
            expectation: {
              expected: expect,
              timeoutSeconds,
              ...expectation,
            },
          },
          jsonMode,
        );
        return;
      }

      case "target-resolve": {
        const params = AgentResolveTargetParamsSchema.parse({
          projectDir: asString(options["project-dir"]),
          environment: asString(options.environment),
          port: normalizePortOption(asString(options.port)),
          bindingTtlSeconds: asNumber(options["binding-ttl"]),
        });
        const result = await resolveTarget(params);
        printOutput(result, jsonMode);
        return;
      }

      case "monitor-status": {
        const params = GetMonitorStatusParamsSchema.parse({
          projectDir: asString(options["project-dir"]),
          port: normalizePortOption(asString(options.port)),
        });
        const result = getMonitorStatus(params.port, params.projectDir);
        printOutput(result, jsonMode);
        return;
      }

      case "monitor-health": {
        const params = AgentMonitorHealthParamsSchema.parse({
          projectDir: asString(options["project-dir"]),
          environment: asString(options.environment),
          port: normalizePortOption(asString(options.port)),
          baudRate: asNumber(options["baud-rate"]),
          captureDurationSeconds: asNumber(options.duration),
          maxBytes: asNumber(options["max-bytes"]),
          expectedMarkers: asCsv(options["expect-all"]),
          rejectedPatterns: asCsv(options["reject-patterns"]),
          automationKey: asString(options["automation-key"]),
          cursor: asString(options.cursor),
          failureThreshold: asNumber(options["failure-threshold"]),
        });
        const result = await agentMonitorHealth(params);
        printOutput(result, jsonMode);
        return;
      }

      case "task-status": {
        const taskId = positionals[0];
        const params = CheckTaskStatusParamsSchema.parse({
          taskId,
          projectDir: asString(options["project-dir"]),
          logPath: asString(options["log-path"]),
        });
        const result = await checkTaskStatusSummaryCore(params);
        printOutput(result, jsonMode);
        return;
      }

      case "task-history": {
        const params = ListTaskHistoryParamsSchema.parse({
          projectDir: asString(options["project-dir"]),
          limit: asNumber(options.limit),
          status: asString(options.status),
        });
        const result = await listTaskHistoryCore(params);
        printOutput(result, jsonMode);
        return;
      }

      case "agent-validate": {
        const params = AgentValidateProjectParamsSchema.parse({
          projectDir: asString(options["project-dir"]),
        });
        const result = await agentValidateProject(params.projectDir);
        printOutput(result, jsonMode);
        return;
      }

      case "agent-build-diagnose": {
        const params = AgentBuildDiagnoseParamsSchema.parse({
          projectDir: asString(options["project-dir"]),
          environment: asString(options.environment),
          verbose: asBoolean(options.verbose),
          background: asBoolean(options.background),
        });
        const result = await agentBuildDiagnose(
          params.projectDir,
          params.environment,
          params.verbose,
          params.background,
        );
        printOutput(result, jsonMode);
        return;
      }

      case "agent-safe-pin-audit": {
        const params = AgentSafePinAuditParamsSchema.parse({
          projectDir: asString(options["project-dir"]),
          boardId: asString(options.board),
        });
        const result = await agentSafePinAudit(
          params.projectDir,
          params.boardId,
        );
        printOutput(result, jsonMode);
        return;
      }

      case "agent-flash-monitor-verify": {
        const params = AgentFlashMonitorVerifyParamsSchema.parse({
          projectDir: asString(options["project-dir"]),
          environment: asString(options.environment),
          port: normalizePortOption(asString(options.port)),
          expect_all: asCsv(options["expect-all"]),
          reject_patterns: asCsv(options["reject-patterns"]),
          timeoutSeconds: asNumber(options.timeout),
          stabilityWindowSeconds: asNumber(options["stability-window"]),
          autoBuild: asBoolean(options["auto-build"]),
        });
        const result = await agentFlashMonitorVerify({
          projectDir: params.projectDir,
          environment: params.environment,
          port: params.port,
          expectAll: params.expect_all,
          rejectPatterns: params.reject_patterns,
          timeoutSeconds: params.timeoutSeconds,
          stabilityWindowSeconds: params.stabilityWindowSeconds,
          autoBuild: params.autoBuild,
        });
        printOutput(result, jsonMode);
        return;
      }

      case "agent-last-report": {
        const params = AgentGetLastReportParamsSchema.parse({
          projectDir: asString(options["project-dir"]),
        });
        const result = await agentGetLastReport(params.projectDir);
        printOutput(result, jsonMode);
        return;
      }

      case "agent-board-report": {
        const params = AgentGenerateBoardReportParamsSchema.parse({
          projectDir: asString(options["project-dir"]),
          boardId: asString(options.board),
        });
        const result = await agentGenerateBoardReport(
          params.projectDir,
          params.boardId,
        );
        printOutput(result, jsonMode);
        return;
      }

      case "policy-status": {
        const params = GetPolicyStatusParamsSchema.parse({
          projectDir: asString(options["project-dir"]),
        });
        const result = getPolicyStatus(params.projectDir);
        printOutput(result, jsonMode);
        return;
      }

      case "dashboard": {
        const params = GetDashboardUrlParamsSchema.parse({
          open: true,
          projectDir: asString(options["project-dir"]),
        });
        const result = await getDashboardStatusCore(params);
        printOutput(result, jsonMode);
        return;
      }

      case "approvals": {
        const status = asString(options.status) as
          | "pending"
          | "approved"
          | "denied"
          | "expired"
          | undefined;
        const limit = asNumber(options.limit);
        const result = listApprovalRequests({ status, limit });
        printOutput(result, jsonMode);
        return;
      }

      case "approval-status": {
        const params = GetApprovalRequestParamsSchema.parse({
          approvalId: positionals[0],
          projectDir: asString(options["project-dir"]),
        });
        const result = getApprovalRequestSummary(
          params.approvalId,
          params.projectDir,
        );
        if (!result) {
          throw new Error(
            `Approval request '${params.approvalId}' was not found in this scope.`,
          );
        }
        printOutput(result, jsonMode);
        return;
      }

      case "pending-approvals": {
        const params = ListPendingApprovalsParamsSchema.parse({
          projectDir: asString(options["project-dir"]),
          limit: asNumber(options.limit),
        });
        const result = listPendingApprovalSummaries(params);
        printOutput({ approvals: result }, jsonMode);
        return;
      }

      case "approve": {
        const approvalId = positionals[0];
        if (!approvalId) {
          throw new Error("Usage: approve <approval-id>");
        }
        const existing = getApproval(approvalId);
        if (!existing) {
          throw new Error(`Approval not found: ${approvalId}`);
        }
        const approval = approveRequest(approvalId);
        printOutput({ success: true, approval }, jsonMode);
        return;
      }

      case "deny": {
        const approvalId = positionals[0];
        if (!approvalId) {
          throw new Error("Usage: deny <approval-id>");
        }
        const existing = getApproval(approvalId);
        if (!existing) {
          throw new Error(`Approval not found: ${approvalId}`);
        }
        const approval = denyRequest(approvalId);
        printOutput({ success: true, approval }, jsonMode);
        return;
      }

      case "install": {
        await runInstallSubcommand(rawArgs);
        if (!jsonMode) {
          console.log("Installer completed.");
        } else {
          console.log(JSON.stringify({ success: true }, null, 2));
        }
        return;
      }

      case "plugin": {
        const result = await runPluginSubcommand(rawArgs);
        printOutput(
          {
            success: true,
            ...result,
          },
          jsonMode,
        );
        return;
      }

      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    const stageMap: Record<string, string> = {
      devices: "devices",
      boards: "boards",
      init: "init",
      build: "build",
      flash: "upload",
      monitor: "monitor",
      "target-resolve": "devices",
      "monitor-status": "monitor",
      "monitor-health": "monitor",
      "task-status": "tasks",
      "task-history": "tasks",
      "agent-validate": "agent",
      "agent-build-diagnose": "build",
      "agent-safe-pin-audit": "agent",
      "agent-flash-monitor-verify": "upload",
      "agent-last-report": "agent",
      "agent-board-report": "agent",
      "policy-status": "policy",
      approvals: "policy",
      "approval-status": "policy",
      "pending-approvals": "policy",
      approve: "policy",
      deny: "policy",
      dashboard: "dashboard",
      install: "install",
      plugin: "plugin",
    };
    const structured = toCliStructuredError(error, {
      stage: stageMap[command] ?? "unknown",
    });

    if (jsonMode) {
      console.error(JSON.stringify(structured, null, 2));
    } else {
      console.error(`Error (${structured.errorType}): ${structured.summary}`);
      console.error(`Recommended action: ${structured.recommendedAction}`);
    }
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const knownCommands = new Set([
    "devices",
    "boards",
    "init",
    "build",
    "flash",
    "monitor",
    "target-resolve",
    "monitor-status",
    "monitor-health",
    "task-status",
    "task-history",
    "agent-validate",
    "agent-build-diagnose",
    "agent-safe-pin-audit",
    "agent-flash-monitor-verify",
    "agent-last-report",
    "agent-board-report",
    "policy-status",
    "approvals",
    "approval-status",
    "pending-approvals",
    "approve",
    "deny",
    "dashboard",
    "install",
    "plugin",
  ]);

  if (args.includes("--help") || command === "help") {
    printCliHelp();
    return;
  }

  if (args.includes("--version") || command === "version") {
    console.log(readVersion());
    return;
  }

  if (command && knownCommands.has(command)) {
    await runCliCommand(command, args.slice(1));
    return;
  }

  if (command && !command.startsWith("--")) {
    console.error(`Unknown command: ${command}`);
    printCliHelp();
    process.exit(1);
  }

  // No CLI command was passed: preserve legacy behavior and start MCP server.
  await import("./index.js");
}

main().catch((error) => {
  const structured = toCliStructuredError(error);
  console.error(JSON.stringify(structured, null, 2));
  process.exit(1);
});
