#!/usr/bin/env node
import { executeCoredump } from "./tools/coredump.js";
import { executePartitionTable } from "./tools/partition-table.js";

import { executeRunTargetAction } from "./tools/run-target.js";
import { SerialClientContext } from "./adapters/serial-client.js";
import { readRuntimeVersion } from "./utils/runtime-version.js";
import { inspectDependencies } from "./tools/dependency-inspection.js";
import { parseCompatibilityLaunch } from "./adapters/compatibility-mode.js";
import {
  executeProjectInspection,
  type ProjectInspectionAction,
} from "./tools/project-inspection.js";
import { executePackageAction, type PackageAction } from "./tools/packages.js";
import { decodeBacktrace, firmwareSizeReport } from "./tools/analysis.js";
import { operationForCliCommand } from "./core/action-catalog.js";
import {
  enrollProjectPolicy,
  revokeProjectPolicy,
} from "./core/policy/project-enrollment.js";
import fs from "node:fs";
import { configurePolicyFileFromArgs } from "./core/policy/policy-sources.js";
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
  CleanProjectParamsSchema,
  CheckProjectParamsSchema,
  RunTestsParamsSchema,
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
import { cleanProject, checkProject, runTests } from "./tools/build.js";
import { runTestsWithReport } from "./core/test-report-execution.js";
import { hardwareLockManager } from "./utils/lock-manager.js";
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
import { authorizeAction } from "./core/action-dispatcher.js";
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
  console.log(`PIO Agent (pio-agent / platformio-mcp)

USAGE:
  pio-agent <command> [options]
  platformio-mcp <command> [options]

COMMANDS:
  devices
  boards --filter <value>
  init --board <id> --project-dir <dir> [--framework <name>]
  build --project-dir <dir> [--environment <env>] [--jobs <count>] [--force-execution] [--background] [--verbose]
  clean --project-dir <dir> [--environment <env>] [--full] [--background]
  check --project-dir <dir> [--environment <env>] [--severity <low|medium|high>] [--pattern <glob>] [--tool <name>] [--skip-packages] [--structured-report] [--background]
  test --project-dir <dir> [--environment <env>] [--filter <glob>] [--ignore <glob>] [--compile-only] [--without-uploading] [--without-building] [--upload-port <port>] [--verbose] [--structured-report] [--background]
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
  decode-backtrace --project-dir <dir> --environment <env> <--text <value>|--text-file <path>> [--include-all-hex]
  size-report --project-dir <dir> --environment <env> [--top <n>] [--filter <regex>]
  deps-check --project-dir <dir> [--environment <env>] [--build]
  project-envs --project-dir <dir>
  project-metadata|list-targets --project-dir <dir> [--environment <env>]
  coredump --project-dir <dir> (--dump-path <file> | --port <port> --table-path <csv> --table-offset <bytes>) [--format <raw|base64>] [--analyze false | --elf-path <file>]
  partition-table --project-dir <dir> [--environment <env>] [--table-path <file>] [--format <csv|binary>] [--table-offset <bytes> | --sdkconfig-path <file>] [--flash-size <bytes>] [--firmware-path <file>] [--observed-table-path <file>]
  run-target --project-dir <dir> --target <name> [--environment <env>] [--upload-port <port>]
  pkg-search --query <query> [--kind library|platform|tool] [--page <n>]
  pkg-install --project-dir <dir> --spec <package> [--kind library|platform|tool] [--environment <env>]
  pkg-uninstall --project-dir <dir> --spec <package> [--kind library|platform|tool] [--environment <env>]
  pkg-list|pkg-outdated|pkg-update --project-dir <dir> [--environment <env>]
  policy-status [--project-dir <dir>]
  policy-enroll --project-dir <dir>
  policy-revoke --project-dir <dir>
  approvals [--status <pending|approved|denied|expired|consumed>] [--limit <n>]
  approval-status <approval-id> [--project-dir <dir>]
  pending-approvals [--project-dir <dir>] [--limit <n>]
  approve <approval-id>
  deny <approval-id>
  dashboard
  install --<cline|claude|vscode|antigravity|codex|codex-plugin>
  plugin validate [--require-runtime]

GLOBAL FLAGS:
  --policy-file <path>  Explicit operator policy (or PIO_MCP_POLICY_FILE)
  --compat platformio-mcp-python  Enable additional MCP compatibility tools
                                 (or PIO_MCP_COMPAT=platformio-mcp-python)
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
  return readRuntimeVersion(import.meta.url);
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

/** Reads at most 1 MiB of regular crash-log input without trusting a prior file-size check. */
function readCrashTextFile(file: string): string {
  const descriptor = fs.openSync(file, "r");
  try {
    if (!fs.fstatSync(descriptor).isFile())
      throw new PlatformIOError(
        "Crash input must be a regular file.",
        "ANALYSIS_INPUT_INVALID",
      );
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(
        descriptor,
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!count) break;
      length += count;
    }
    if (length > 1024 * 1024)
      throw new PlatformIOError(
        "Crash text exceeds 1 MiB.",
        "ANALYSIS_INPUT_LIMIT",
      );
    return buffer.subarray(0, length).toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

async function runCliCommand(command: string, rawArgs: string[]) {
  const { options, positionals } = parseArgs(rawArgs);
  const jsonMode = Boolean(options.json);
  const actionName = operationForCliCommand(command);
  const projectInspection = [
    "project-envs",
    "project-metadata",
    "list-targets",
  ].includes(command);
  const projectDirForPolicy = asString(options["project-dir"]);
  const approvalOpt = asBoolean(options.approve);
  let policyArgs: Record<string, unknown> = {
    ...options,
    projectDir: projectDirForPolicy,
  };

  try {
    if (command === "coredump") {
      const allowed = new Set(["json", "project-dir", "dump-path", "format", "analyze", "elf-path", "expected-input-sha256", "expected-elf-sha256", "encrypted", "approval-id", "command-approval-id", "port", "partition-name", "table-path", "table-format", "table-offset", "sdkconfig-path", "environment", "flash-size", "build-metadata", "table-approval-id", "config-approval-id", "metadata-approval-id", "system-approval-id", "board-approval-id", "read-approval-id", "read-command-approval-id"]);
      if (positionals.length || Object.keys(options).some((key) => !allowed.has(key)))
        throw new PlatformIOError("Unknown core-dump option or positional argument.", "COREDUMP_INPUT_INVALID");
      for (const key of ["analyze", "encrypted", "build-metadata"])
        if (options[key] !== undefined && ![true, false, "true", "false"].includes(options[key]))
          throw new PlatformIOError("Expected true or false for --" + key, "COREDUMP_INPUT_INVALID");
      const port = asString(options.port);
      const deviceOptions = ["partition-name", "table-path", "table-format", "table-offset", "sdkconfig-path", "environment", "flash-size", "build-metadata", "table-approval-id", "config-approval-id", "metadata-approval-id", "system-approval-id", "board-approval-id", "read-approval-id", "read-command-approval-id"];
      if (!port && deviceOptions.some((key) => options[key] !== undefined))
        throw new PlatformIOError("Device/table options require --port.", "COREDUMP_INPUT_INVALID");
      const integerOption = (key: string) => {
        const value = asString(options[key]);
        if (value === undefined) return undefined;
        if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value))
          throw new PlatformIOError("Expected integer bytes for --" + key, "COREDUMP_INPUT_INVALID");
        return Number(value);
      };
      const device = port ? {
        port, partitionName: asString(options["partition-name"]),
        approvalId: asString(options["read-approval-id"]), commandApprovalId: asString(options["read-command-approval-id"]),
        table: {
          projectDir: projectDirForPolicy, tablePath: asString(options["table-path"]),
          format: asString(options["table-format"]), tableOffset: integerOption("table-offset"),
          sdkconfigPath: asString(options["sdkconfig-path"]), environment: asString(options.environment),
          flashSize: integerOption("flash-size"), buildMetadata: asBoolean(options["build-metadata"]) ?? false,
          approvalId: asString(options["table-approval-id"]), configApprovalId: asString(options["config-approval-id"]),
          metadataApprovalId: asString(options["metadata-approval-id"]), systemApprovalId: asString(options["system-approval-id"]), boardApprovalId: asString(options["board-approval-id"]),
        },
      } : undefined;
      const result = await executeCoredump({
        device,
        projectDir: projectDirForPolicy, dumpPath: asString(options["dump-path"]),
        format: asString(options.format), analyze: asBoolean(options.analyze) ?? true,
        elfPath: asString(options["elf-path"]), encrypted: asBoolean(options.encrypted) ?? false,
        expectedInputSha256: asString(options["expected-input-sha256"]), expectedElfSha256: asString(options["expected-elf-sha256"]),
        approvalId: asString(options["approval-id"]), commandApprovalId: asString(options["command-approval-id"]),
      }, { workspaceDir: projectDirForPolicy, actor: "user" });
      printOutput(result, jsonMode);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === "partition-table") {
      const allowed = new Set(["json", "project-dir", "table-path", "format", "table-offset", "sdkconfig-path", "read-device", "port", "read-approval-id", "command-approval-id", "build-metadata", "metadata-approval-id", "system-approval-id", "board-approval-id", "environment", "config-approval-id", "flash-size", "firmware-path", "observed-table-path", "approval-id"]);
      if (positionals.length || Object.keys(options).some((key) => !allowed.has(key)))
        throw new PlatformIOError("Unknown partition inspection argument.", "PARTITION_INPUT_INVALID");
      if (options["read-device"] !== undefined && ![true, false, "true", "false"].includes(options["read-device"]))
        throw new PlatformIOError("--read-device must be true or false.", "PARTITION_INPUT_INVALID");
      if (options["build-metadata"] !== undefined && ![true, false, "true", "false"].includes(options["build-metadata"]))
        throw new PlatformIOError("--build-metadata must be true or false.", "PARTITION_INPUT_INVALID");
      const numberOption = (key: string) => {
        const value = asString(options[key]);
        if (value === undefined) return undefined;
        if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value))
          throw new PlatformIOError("Expected integer bytes for --" + key, "PARTITION_INPUT_INVALID");
        return Number(value);
      };
      const result = await executePartitionTable({
        projectDir: projectDirForPolicy, tablePath: asString(options["table-path"]),
        format: asString(options.format), tableOffset: numberOption("table-offset"),
        sdkconfigPath: asString(options["sdkconfig-path"]),
        readDevice: asBoolean(options["read-device"]) ?? false, port: asString(options.port),
        readApprovalId: asString(options["read-approval-id"]), commandApprovalId: asString(options["command-approval-id"]),
        buildMetadata: asBoolean(options["build-metadata"]) ?? false, metadataApprovalId: asString(options["metadata-approval-id"]), systemApprovalId: asString(options["system-approval-id"]), boardApprovalId: asString(options["board-approval-id"]),
        environment: asString(options.environment), configApprovalId: asString(options["config-approval-id"]),
        flashSize: numberOption("flash-size"), firmwarePath: asString(options["firmware-path"]),
        observedTablePath: asString(options["observed-table-path"]), approvalId: asString(options["approval-id"]),
      }, {workspaceDir: projectDirForPolicy, actor: "user"});
      printOutput(result, jsonMode);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === "run-target") {
      const allowed = new Set([
        "json", "project-dir", "target", "environment", "upload-port",
        "stop-open-sessions", "approval-id", "config-approval-id", "selection-approval-id",
      ]);
      if (positionals.length || Object.keys(options).some((key) => !allowed.has(key)))
        throw new PlatformIOError("Unknown named-target option or positional argument.", "TARGET_INPUT_INVALID");
      if (options["stop-open-sessions"] !== undefined &&
          ![true, false, "true", "false"].includes(options["stop-open-sessions"]))
        throw new PlatformIOError("--stop-open-sessions must be true or false.", "TARGET_INPUT_INVALID");
      const client = new SerialClientContext();
      try {
        const result = await executeRunTargetAction({
          projectDir: projectDirForPolicy, target: asString(options.target),
          environment: asString(options.environment), uploadPort: asString(options["upload-port"]),
          stopOpenSessions: asBoolean(options["stop-open-sessions"]) ?? false,
          approvalId: asString(options["approval-id"]),
          configApprovalId: asString(options["config-approval-id"]),
          selectionApprovalId: asString(options["selection-approval-id"]),
        }, client, { workspaceDir: projectDirForPolicy, actor: "user" });
        printOutput(result, jsonMode);
        if (!result.ok) process.exitCode = 1;
      } finally {
        await client.close();
      }
      return;
    }
    // Operator administration stays local to the CLI, including recovery from invalid policy.
    // This is not proof of human identity against a process with the same OS-user authority.
    if (command === "policy-enroll" || command === "policy-revoke") {
      const project = asString(options["project-dir"]);
      if (!project) throw new Error(`${command} requires --project-dir`);
      const result =
        command === "policy-enroll"
          ? enrollProjectPolicy(project)
          : (revokeProjectPolicy(project), { revoked: true });
      printOutput(result, jsonMode);
      return;
    }
    if (
      command === "deps-check" ||
      command === "decode-backtrace" ||
      command === "size-report" ||
      command.startsWith("pkg-") ||
      projectInspection
    ) {
      const scope = {
        projectDir: projectDirForPolicy,
        environment: asString(options.environment),
        approvalId: asString(options["approval-id"]),
        expectedElfSha256: asString(options["expected-elf-sha256"]),
      };
      let parameters: Record<string, unknown>;
      if (command === "deps-check") {
        const allowed = new Set([
          "json",
          "project-dir",
          "environment",
          "build",
          "approval-id",
          "configuration-approval-id",
          "inventory-approval-id",
          "build-approval-id",
        ]);
        if (
          positionals.length ||
          Object.keys(options).some((key) => !allowed.has(key))
        )
          throw new PlatformIOError(
            "Unknown dependency inspection option or positional argument.",
            "DEPENDENCY_INPUT_INVALID",
          );
        if (
          options.build !== undefined &&
          ![true, false, "true", "false"].includes(options.build)
        )
          throw new PlatformIOError(
            "--build must be true or false.",
            "DEPENDENCY_INPUT_INVALID",
          );
        parameters = {
          projectDir: scope.projectDir,
          environment: scope.environment,
          build: asBoolean(options.build) ?? false,
          approvalId: scope.approvalId,
          configurationApprovalId: asString(
            options["configuration-approval-id"],
          ),
          inventoryApprovalId: asString(options["inventory-approval-id"]),
          buildApprovalId: asString(options["build-approval-id"]),
        };
      } else if (projectInspection) {
        const allowed = new Set([
          "json",
          "approve",
          "approval-id",
          "project-dir",
          ...(command === "project-envs" ? [] : ["environment"]),
        ]);
        if (
          positionals.length ||
          Object.keys(options).some((key) => !allowed.has(key))
        )
          throw new PlatformIOError(
            "Unknown project inspection option or positional argument.",
            "PROJECT_INPUT_INVALID",
          );
        parameters = {
          projectDir: scope.projectDir,
          approvalId: scope.approvalId,
          ...(command === "project-envs"
            ? {}
            : { environment: scope.environment }),
        };
      } else if (command.startsWith("pkg-")) {
        const allowed = new Set([
          "json",
          "approve",
          "approval-id",
          "project-dir",
          "environment",
          ...(command === "pkg-search"
            ? ["query", "kind", "page"]
            : command === "pkg-install" || command === "pkg-uninstall"
              ? ["spec", "kind"]
              : []),
        ]);
        if (
          positionals.length ||
          Object.keys(options).some((key) => !allowed.has(key))
        )
          throw new PlatformIOError(
            "Unknown package option or positional argument.",
            "PACKAGE_INPUT_INVALID",
          );
        const project = asString(options["project-dir"]);
        if (command !== "pkg-search" && !project)
          throw new PlatformIOError(
            "Package commands require --project-dir.",
            "PACKAGE_INPUT_INVALID",
          );
        parameters =
          command === "pkg-search"
            ? {
                query: asString(options.query),
                kind: asString(options.kind),
                page:
                  options.page === undefined
                    ? undefined
                    : typeof options.page === "string"
                      ? Number(options.page)
                      : NaN,
                approvalId: scope.approvalId,
              }
            : {
                projectDir: project,
                environment: scope.environment,
                approvalId: scope.approvalId,
                ...(command === "pkg-install" || command === "pkg-uninstall"
                  ? {
                      spec: asString(options.spec),
                      kind: asString(options.kind),
                    }
                  : {}),
              };
      } else if (command === "decode-backtrace") {
        const text = asString(options.text),
          file = asString(options["text-file"]);
        if ((text === undefined) === (file === undefined))
          throw new PlatformIOError(
            "Provide exactly one of --text or --text-file.",
            "ANALYSIS_INPUT_INVALID",
          );
        parameters = {
          ...scope,
          text: file !== undefined ? readCrashTextFile(file) : text,
          includeAllHex: asBoolean(options["include-all-hex"]),
          archivedElfSha256: asString(options["archived-elf-sha256"]),
        };
      } else
        parameters = {
          ...scope,
          top:
            options.top === undefined
              ? undefined
              : typeof options.top === "string"
                ? Number(options.top)
                : NaN,
          filter: asString(options.filter),
        };
      const run = (args: Record<string, unknown>) =>
        command === "deps-check"
          ? inspectDependencies(args, {
              actor: "user",
              actorClass: "interactive",
            })
          : projectInspection
            ? executeProjectInspection(
                command.replaceAll("-", "_") as ProjectInspectionAction,
                args,
                { actor: "user", actorClass: "interactive" },
              )
            : command.startsWith("pkg-")
              ? executePackageAction(
                  command.replace("pkg-", "pkg_") as PackageAction,
                  args,
                  {
                    actor: "user",
                    actorClass: "interactive",
                    workspaceDir: projectDirForPolicy,
                  },
                )
              : (command === "decode-backtrace"
                  ? decodeBacktrace
                  : firmwareSizeReport)(args, {
                  actor: "user",
                  actorClass: "interactive",
                });
      let result;
      try {
        result = await run(parameters);
      } catch (error) {
        if (
          command === "deps-check" ||
          !(error instanceof PlatformIOError) ||
          error.code !== "APPROVAL_REQUIRED" ||
          (jsonMode && approvalOpt !== true)
        )
          throw error;
        const decision = error.context?.policyDecision as
          | { reason: string; approvalId?: string }
          | undefined;
        if (!decision?.approvalId) throw error;
        if (approvalOpt !== true && !(await promptApproval(decision.reason)))
          throw new PlatformIOError(
            "Action cancelled by user.",
            "APPROVAL_DENIED",
          );
        if (!approveRequest(decision.approvalId)) throw error;
        result = await run({ ...parameters, approvalId: decision.approvalId });
      }
      printOutput(result, jsonMode);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    let decision = await authorizeAction(actionName, policyArgs, {
      workspaceDir: projectDirForPolicy,
      actor: "user",
      operationName: operationForCliCommand(command),
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

      if (!decision.approvalId || !approveRequest(decision.approvalId)) {
        throw new PlatformIOError(
          "Approval request is no longer available.",
          "APPROVAL_REQUIRED",
        );
      }
      policyArgs = {
        ...policyArgs,
        approvalId: decision.approvalId,
      };
      decision = await authorizeAction(actionName, policyArgs, {
        workspaceDir: projectDirForPolicy,
        actor: "user",
        operationName: operationForCliCommand(command),
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
          jobs: asNumber(options.jobs),
          forceExecution: asBoolean(options["force-execution"]),
          background: asBoolean(options.background),
        });
        const result = await buildProjectCore(params);
        printOutput(result, jsonMode);
        return;
      }

      case "clean": {
        const params = CleanProjectParamsSchema.parse({ projectDir: asString(options["project-dir"]), environment: asString(options.environment), full: asBoolean(options.full), background: asBoolean(options.background) });
        const result = await hardwareLockManager.withImplicitLock(() => cleanProject(params.projectDir, params.background, { environment: params.environment, full: params.full }));
        printOutput(result, jsonMode);
        if (result.success === false) process.exitCode = 1;
        return;
      }
      case "check": {
        const params = CheckProjectParamsSchema.parse({ projectDir: asString(options["project-dir"]), environment: asString(options.environment), severity: asString(options.severity), pattern: asString(options.pattern), tool: asString(options.tool), skipPackages: asBoolean(options["skip-packages"]), structuredReport: asBoolean(options["structured-report"]), background: asBoolean(options.background) });
        const result = await hardwareLockManager.withImplicitLock(() => checkProject(params.projectDir, params.environment, params.background, { severity: params.severity, pattern: params.pattern, tool: params.tool, skipPackages: params.skipPackages, jsonOutput: params.structuredReport }));
        printOutput(result, jsonMode);
        if (result.success === false) process.exitCode = 1;
        return;
      }
      case "test": {
        const params = RunTestsParamsSchema.parse({ projectDir: asString(options["project-dir"]), environment: asString(options.environment), filter: asString(options.filter), ignore: asString(options.ignore), compileOnly: asBoolean(options["compile-only"]), withoutUploading: asBoolean(options["without-uploading"]), withoutBuilding: asBoolean(options["without-building"]), uploadPort: asString(options["upload-port"]), verbose: asBoolean(options.verbose), structuredReport: asBoolean(options["structured-report"]), background: asBoolean(options.background) });
        if (params.structuredReport && params.background) throw new PlatformIOError("Structured test reports require foreground execution", "INVALID_ARGUMENT");
        const selection = { filter: params.filter, ignore: params.ignore, withoutUploading: params.withoutUploading, withoutBuilding: params.withoutBuilding, uploadPort: params.uploadPort, verbose: params.verbose };
        const result = await hardwareLockManager.withImplicitLock(() => params.structuredReport
          ? runTestsWithReport(params.projectDir, params.environment, params.compileOnly, selection)
          : runTests(params.projectDir, params.environment, params.background, params.compileOnly, selection));
        printOutput(result, jsonMode);
        if (result.success === false) process.exitCode = 1;
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
          | "consumed"
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
      "project-envs": "inspection",
      "project-metadata": "inspection",
      "list-targets": "inspection",
      "run-target": "build",

      "pkg-search": "packages",
      "pkg-install": "packages",
      "pkg-uninstall": "packages",
      "pkg-list": "packages",
      "pkg-outdated": "packages",
      "pkg-update": "packages",

      "decode-backtrace": "analysis",
      "size-report": "analysis",
      devices: "devices",
      boards: "boards",
      init: "init",
      build: "build",
      clean: "build",
      check: "analysis",
      test: "test",
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
  const args = configurePolicyFileFromArgs(
    parseCompatibilityLaunch(process.argv.slice(2)).args,
  );
  const command = args[0];
  const knownCommands = new Set([
    "coredump",
    "partition-table",
    "run-target",
    "deps-check",
    "project-envs",
    "project-metadata",
    "list-targets",

    "pkg-search",
    "pkg-install",
    "pkg-uninstall",
    "pkg-list",
    "pkg-outdated",
    "pkg-update",

    "decode-backtrace",
    "size-report",
    "devices",
    "boards",
    "init",
    "build",
    "clean",
    "check",
    "test",
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
    "policy-enroll",
    "policy-revoke",
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
