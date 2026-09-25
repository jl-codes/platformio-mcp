#!/usr/bin/env node

import fs from "node:fs";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PlatformIOError } from "./utils/errors.js";
import { toCliStructuredError } from "./core/cli-diagnostics.js";
import { authorizeAction } from "./core/action-dispatcher.js";
import { approveRequest } from "./core/policy/approvals.js";
import { operationForCliCommand } from "./core/action-catalog.js";
import { configurePolicyFileFromArgs } from "./core/policy/policy-sources.js";
import { parseCompatibilityLaunch } from "./adapters/compatibility-mode.js";
import { readRuntimeVersion } from "./utils/runtime-version.js";
import { printOutput } from "./cli/output.js";
import { promptApproval } from "./cli/prompt.js";
import { mcpContext } from "./utils/mcp-context.js";
import type { CommandHandler, OptionValue } from "./cli/commands/types.js";
import { devices } from "./cli/commands/devices.js";
import { boards, boardInfo } from "./cli/commands/boards.js";
import { init, project, check, clean, test } from "./cli/commands/project.js";
import { lib } from "./cli/commands/lib.js";
import { logs } from "./cli/commands/logs.js";
import { build } from "./cli/commands/build.js";
import { flash, uploadFs } from "./cli/commands/flash.js";
import {
  monitor,
  monitorStatus,
  monitorHealth,
  monitorStop,
} from "./cli/commands/monitor.js";
import { taskStatus, taskHistory, taskCancel } from "./cli/commands/task.js";
import {
  targetResolve,
  agentValidate,
  agentBuildDiagnoseCmd,
  agentSafePinAuditCmd,
  agentFlashMonitorVerifyCmd,
  agentLastReport,
  agentBoardReport,
} from "./cli/commands/agent.js";
import {
  policyStatus,
  approvals,
  approvalStatus,
  pendingApprovals,
  approve,
  deny,
} from "./cli/commands/policy.js";
import { lockStatus, portRelease } from "./cli/commands/lock.js";
import {
  dashboard,
  install,
  plugin,
  systemInfo,
} from "./cli/commands/system.js";
import {
  SELF_AUTHORIZING_COMMANDS,
  runSelfAuthorizingCommand,
} from "./cli/commands/self-authorizing.js";
import { asString, asBoolean } from "./cli/args.js";

export const COMMANDS: Record<string, CommandHandler> = {
  devices,
  boards,
  "board-info": boardInfo,
  init,
  lib,
  project,
  check,
  clean,
  test,
  build,
  flash,
  monitor,
  "monitor-status": monitorStatus,
  "monitor-health": monitorHealth,
  "monitor-stop": monitorStop,
  "task-status": taskStatus,
  "task-history": taskHistory,
  "task-cancel": taskCancel,
  "target-resolve": targetResolve,
  "agent-validate": agentValidate,
  "agent-build-diagnose": agentBuildDiagnoseCmd,
  "agent-safe-pin-audit": agentSafePinAuditCmd,
  "agent-flash-monitor-verify": agentFlashMonitorVerifyCmd,
  "agent-last-report": agentLastReport,
  "agent-board-report": agentBoardReport,
  "policy-status": policyStatus,
  approvals,
  "approval-status": approvalStatus,
  "pending-approvals": pendingApprovals,
  approve,
  deny,
  "lock-status": lockStatus,
  "port-release": portRelease,
  dashboard,
  install,
  plugin,
  logs,
  "system-info": systemInfo,
  "upload-fs": uploadFs,
};

type ParsedArgs = {
  options: Record<string, OptionValue>;
  positionals: string[];
};

function printCliHelp(options: { stream?: "stdout" | "stderr" } = {}) {
  const emit = options.stream === "stderr" ? console.error : console.log;
  emit(`PIO Agent (pio-agent / platformio-mcp)

USAGE:
  pio-agent <command> [options]
  platformio-mcp <command> [options]

COMMANDS:
  devices
  boards --filter <value>
  board-info --board <id>
  init --board <id> --project-dir <dir> [--framework <name>]
  lib search <query> [--limit <n>]
  lib install <name> [--project-dir <dir>] [--version <v>]
  lib uninstall <name> [--project-dir <dir>]
  lib update <name> [--project-dir <dir>]
  lib list [--project-dir <dir>]
  project check --project-dir <dir> [--environment <env>] [--background]
  project config --project-dir <dir>
  project context --project-dir <dir> [--include-build-history]
  build --project-dir <dir> [--environment <env>] [--jobs <count>] [--force-execution] [--background] [--verbose]
  clean --project-dir <dir> [--environment <env>] [--full] [--background]
  check --project-dir <dir> [--environment <env>] [--severity <low|medium|high>] [--pattern <glob>] [--tool <name>] [--skip-packages] [--structured-report] [--background]
  test --project-dir <dir> [--environment <env>] [--filter <glob>] [--ignore <glob>] [--compile-only] [--without-uploading] [--without-building] [--upload-port <port>] [--verbose] [--structured-report] [--background]
  flash --project-dir <dir> [--port <port|auto>] [--environment <env>] [--background] [--start-monitor]
  upload-fs --project-dir <dir> [--port <port>] [--environment <env>] [--verbose] [--background] [--start-monitor]
  monitor [--project-dir <dir>] [--port <port|auto>] [--environment <env>] [--timeout <seconds>] [--expect <text>] [--background]
  target-resolve --project-dir <dir> [--environment <env>] [--port <port>] [--binding-ttl <seconds>]
  monitor-status [--project-dir <dir>] [--port <port>]
  monitor-health --project-dir <dir> [--environment <env>] [--port <port>] [--duration <seconds>] [--expect-all <csv>] [--reject-patterns <csv>]
  monitor-stop --port <port> [--project-dir <dir>]
  task-status <task-id>
  task-history --project-dir <dir> [--status <status>] [--limit <n>]
  task-cancel <task-id> [--project-dir <dir>]
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
  port-diagnose --project-dir <dir> [--port <port>] [--environment <env>] [--approve]
  monitor-capture --project-dir <dir> [--port <port>] [--baud <rate>] [--seconds <n>] [--until <regex>] [--max-lines <n>] [--approve]
  memory-watch --project-dir <dir> [--port <port>] [--baud <rate>] [--seconds <n>] [--pattern <regex>] [--stack-unit bytes|words] [--stack-word-bytes <n>] [--approve]
  debug-run --project-dir <dir> --commands <JSON-array> [--environment <env>] [--load false] [--timeout <seconds>] [--command-timeout <seconds>] [--probe-serial <id>] [--process-only] [--approve]
  upload-ota --project-dir <dir> --host <address> [--environment <env>] [--port <port>] [--filesystem] [--build false] [--verify-reachable false] [--timeout <seconds>] [--auth-env <variable>] [--approve]
  power-profile --project-dir <dir> [--source serial|ppk2] [--port <meter>] [--seconds <n>] [--baud <rate>] [--mode ampere|source --dut-port <port> --voltage-mv <mV> --current-limit-ma <mA>] [--approve]
  flash-verify --project-dir <dir> [--environment <env>] [--upload-port <port>] [--monitor-port <port>] [--baud <rate>] [--expect <regex>] [--fail-on <regex>] [--timeout <seconds>] [--settle <seconds>] [--stability-window <seconds>] [--max-lines <count>] [--stop-open-sessions] [--approve]
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
  dashboard [--serve] [--port <port>] [--operator]
  lock status [--port <port>]
  port release --port <port> [--force]
  install --<cline|claude|vscode|antigravity|codex|codex-plugin>
  plugin validate [--require-runtime]
  logs query [--lines <n>] [--search <text>] [--task-id <id>] [--log-path <p>] [--project-dir <dir>] [--port <port>]
  logs capture --project-dir <dir> [--port <port>] [--environment <env>] [--baud-rate <n>] [--duration <seconds>] [--max-bytes <n>] [--cursor <c>]
  system-info

GLOBAL FLAGS:
  --policy-file <path>  Explicit operator policy (or PIO_MCP_POLICY_FILE)
  --compat platformio-mcp-python  Enable additional MCP compatibility tools
                                 (or PIO_MCP_COMPAT=platformio-mcp-python)
  --json
  --approve
  --help
  --version

SERVER MODE:
  serve                      Start the MCP stdio server explicitly.
  (no command)               Deprecated: starts the MCP server. Use \`serve\`.
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

function readVersion(): string {
  return readRuntimeVersion(import.meta.url);
}

/**
 * Commands that perform work, as opposed to reporting state.
 *
 * Only these map a returned `success: false` to a non-zero exit code. A query
 * answering "no" -- `task-cancel` on an already-finished task, a health probe
 * with nothing to assert against -- has not failed, and exiting non-zero there
 * breaks the idempotent cleanup and classification the skills prescribe.
 *
 * Thrown errors always exit non-zero regardless of this set: a command that
 * could not run at all is a failure whatever it was going to do.
 */
export const OPERATION_COMMANDS = new Set([
  "build",
  "clean",
  "check",
  "test",
  "flash",
  "upload-fs",
  "init",
  "project",
  "lib",
  "agent-build-diagnose",
  "agent-flash-monitor-verify",
]);

/**
 * Commands whose `--background` must genuinely return immediately.
 *
 * The spooler's background mode keeps the PARENT alive: the completion
 * bookkeeping -- task status, PID unregister, port-claim release, the
 * --start-monitor hook -- runs in the parent's `.then()` after the child
 * exits. Under the long-lived MCP server that is exactly right. Under a
 * one-shot CLI it meant `pio-agent build --background` printed
 * `{status:"running"}` and then sat there for the whole build, which is the
 * opposite of what the skills promise agents.
 *
 * So the CLI backgrounds by re-executing ITSELF in foreground mode as a
 * detached child, with the task id assigned up front. The foreground path
 * already does all of the bookkeeping, including onSuccess hooks, so nothing
 * has to be serialised across processes and the MCP path is untouched. The
 * child is short-lived (it ends with the task), which is consistent with
 * "nothing outlives the command it was asked for".
 */
const BACKGROUND_REEXEC_COMMANDS = new Set([
  "build",
  "flash",
  "upload-fs",
  "clean",
  "check",
  "test",
  "project",
]);

/** Hidden flag the detached child receives so both sides agree on the task id. */
const TASK_ID_FLAG = "--__task-id";

function dispatchDetached(
  command: string,
  rest: string[],
  jsonMode: boolean,
): void {
  const taskId = crypto.randomUUID();
  const childArgs = [
    process.argv[1],
    command,
    ...rest.filter((a) => a !== "--background"),
    TASK_ID_FLAG,
    taskId,
  ];
  if (jsonMode && !childArgs.includes("--json")) childArgs.push("--json");

  // The child's own stdout/stderr are not ours to relay -- its result is
  // recorded via task status, which is what `task-status <id>` reads.
  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  printOutput(
    {
      status: "running",
      taskId,
      pid: child.pid,
      message:
        "Task dispatched to a detached process. Poll with " +
        `\`pio-agent task-status ${taskId} --project-dir <dir>\`.`,
    },
    jsonMode,
  );
}

export async function runCliCommand(command: string, rawArgs: string[]) {
  const { options, positionals } = parseArgs(rawArgs);
  const jsonMode = Boolean(options.json);
  const actionName = operationForCliCommand(command, positionals);
  const projectDirForPolicy = asString(options["project-dir"]);
  const approvalOpt = asBoolean(options.approve);
  let policyArgs: Record<string, unknown> = {
    ...options,
    projectDir: projectDirForPolicy,
  };

  try {
    if (SELF_AUTHORIZING_COMMANDS.has(command)) {
      await runSelfAuthorizingCommand(command, {
        options,
        positionals,
        jsonMode,
        rawArgs,
      });
      return;
    }

    let decision = await authorizeAction(actionName, policyArgs, {
      workspaceDir: projectDirForPolicy,
      actor: "user",
      operationName: actionName,
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
        operationName: actionName,
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

    const handler = COMMANDS[command];
    if (handler) {
      if (
        asBoolean(options.background) &&
        BACKGROUND_REEXEC_COMMANDS.has(command)
      ) {
        dispatchDetached(command, rawArgs, jsonMode);
        return;
      }

      // A detached child carries the task id its parent already reported.
      // The spooler reads it from this context as the command id, so
      // `task-status <id>` finds the run without every handler threading it.
      const preassignedTaskId = asString(options["__task-id"]);
      const run = () => handler({ options, positionals, jsonMode, rawArgs });
      const result = preassignedTaskId
        ? await mcpContext.run(
            {
              activityId: preassignedTaskId,
              targetProjectDir: asString(options["project-dir"]),
            },
            run,
          )
        : await run();
      if (result !== undefined) {
        printOutput(result, jsonMode);
        // `success: false` is overloaded: for a command that DOES work it
        // means the work failed, but for a query it often just means the
        // answer was negative -- no task by that id, a health probe that was
        // inconclusive, no logs yet. Only the former is a process failure.
        // Mapping both to exit 1 made `monitor-health` fail on its own
        // documented invocation and `task-cancel` fail at being idempotent.
        if (
          OPERATION_COMMANDS.has(command) &&
          result !== null &&
          typeof result === "object" &&
          (result as { success?: unknown }).success === false
        ) {
          process.exitCode = 1;
        }
      }
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    const stageMap: Record<string, string> = {
      "project-envs": "inspection",
      "project-metadata": "inspection",
      "list-targets": "inspection",
      "run-target": "build",
      "flash-verify": "upload",
      "power-profile": "monitor",
      "debug-run": "debugger",
      "upload-ota": "upload",
      coredump: "analysis",
      "partition-table": "analysis",
      "port-diagnose": "devices",
      "monitor-capture": "monitor",
      "memory-watch": "monitor",
      "deps-check": "packages",
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
      "board-info": "boards",
      init: "init",
      build: "build",
      clean: "build",
      check: "analysis",
      test: "test",
      flash: "upload",
      "upload-fs": "upload",
      monitor: "monitor",
      "target-resolve": "devices",
      "monitor-status": "monitor",
      "monitor-health": "monitor",
      "monitor-stop": "monitor",
      "task-status": "tasks",
      "task-history": "tasks",
      "task-cancel": "tasks",
      "agent-validate": "agent",
      "agent-build-diagnose": "build",
      "agent-safe-pin-audit": "agent",
      "agent-flash-monitor-verify": "upload",
      "agent-last-report": "agent",
      "agent-board-report": "agent",
      "policy-status": "policy",
      "policy-enroll": "policy",
      "policy-revoke": "policy",
      approvals: "policy",
      "approval-status": "policy",
      "pending-approvals": "policy",
      approve: "policy",
      deny: "policy",
      dashboard: "dashboard",
      "lock-status": "lock",
      "port-release": "port",
      install: "install",
      plugin: "plugin",
      lib: "lib",
      project: "project",
      logs: "monitor",
      "system-info": "system",
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
  // --compat and --policy-file are global and consumed here; the MCP server
  // (src/index.ts) re-parses process.argv itself and handles the same two.
  const args = configurePolicyFileFromArgs(
    parseCompatibilityLaunch(process.argv.slice(2)).args,
  );
  const command = args[0];
  const knownCommands = new Set([
    ...Object.keys(COMMANDS),
    ...SELF_AUTHORIZING_COMMANDS,
  ]);

  // --help never takes a value, so it is safe to honour anywhere: `pio-agent
  // build --help` must work, and the CLI's own error messages point at it.
  // --version DOES take a value in `lib install <name> --version 1.2.3` -- the
  // form the pio-manager skill prescribes -- so it is global only when it
  // leads; after a command it belongs to that command.
  if (args.includes("--help") || command === "help") {
    printCliHelp();
    return;
  }

  if (command === "--version" || command === "version") {
    console.log(readVersion());
    return;
  }

  // Any other leading flag (`pio-agent --json`) is a mistake, not a request to
  // start the MCP server, which is what falling through would do.
  if (command?.startsWith("--")) {
    console.error(`Unknown option: ${command}`);
    printCliHelp({ stream: "stderr" });
    process.exit(1);
  }

  // Fold two-word forms ("lock status", "port release") into their registry
  // keys before the knownCommands lookup.
  const TWO_WORD = new Set(["lock", "port"]);
  let resolved = command;
  let rest = args.slice(1);
  if (
    command &&
    TWO_WORD.has(command) &&
    rest[0] &&
    !rest[0].startsWith("--")
  ) {
    resolved = `${command}-${rest[0]}`;
    rest = rest.slice(1);
  }

  if (resolved && knownCommands.has(resolved)) {
    await runCliCommand(resolved, rest);
    return;
  }

  if (command === "serve") {
    // src/index.ts's own main() re-parses process.argv (it is not spawned as
    // a new process — the array is shared) and treats the first non-flag
    // token as its own subcommand. Left as "serve", it would see an
    // unrecognized subcommand, print its help to stdout, and never start the
    // MCP server. Strip the "serve" word but keep any other flags (e.g.
    // --compat, --policy-file) so they still reach index.ts's parsing.
    process.argv = [
      process.argv[0],
      process.argv[1],
      ...process.argv.slice(2).filter((token) => token !== "serve"),
    ];
    await import("./index.js");
    return;
  }

  if (command && !command.startsWith("--")) {
    // stdout stays clean on failure: a caller parsing --json must not receive
    // 3KB of help text where a payload was expected.
    console.error(`Unknown command: ${command}`);
    printCliHelp({ stream: "stderr" });
    process.exit(1);
  }

  // Bare invocation still starts the MCP server so existing client configs
  // keep working. The warning goes to stderr only: stdout carries MCP stdio
  // JSON-RPC framing and must never be polluted with anything else.
  console.error(
    "[pio-agent] Starting the MCP server because no command was given.\n" +
      "[pio-agent] This is deprecated. Use `pio-agent serve` to start the MCP\n" +
      "[pio-agent] server explicitly, or run a command such as `pio-agent build`.\n" +
      "[pio-agent] Run `pio-agent --help` to see all commands.",
  );
  await import("./index.js");
}

/**
 * True only when this file is the process entry point (run directly via
 * `node build/cli.js`, the `pio-agent`/`platformio-mcp` bin symlinks, or
 * `tsx src/cli.ts`) rather than imported as a module — e.g. by
 * tests/cli-agent-smoke.test.ts, which spawns it as a child process, but
 * still resolves the same file. realpath both sides so a bin symlink still
 * compares equal to the resolved module path.
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    // Compare canonical forms on both sides. realpathSync returns the on-disk
    // casing via GetFinalPathNameByHandleW on Windows while the module URL may
    // carry the casing the caller typed, and a drive-letter or 8.3 mismatch
    // would make this silently false -- main() never runs, exit 0, no output.
    const canon = (f: string) => {
      const r = path.resolve(f);
      return process.platform === "win32" ? r.toLowerCase() : r;
    };
    return (
      canon(fs.realpathSync(entry)) ===
      canon(fs.realpathSync(fileURLToPath(import.meta.url)))
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((error) => {
    const structured = toCliStructuredError(error);
    console.error(JSON.stringify(structured, null, 2));
    process.exit(1);
  });
}
