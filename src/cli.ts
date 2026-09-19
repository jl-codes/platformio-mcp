#!/usr/bin/env node

import fs from "node:fs";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { PlatformIOError } from "./utils/errors.js";
import { toCliStructuredError } from "./core/cli-diagnostics.js";
import { evaluatePolicy } from "./core/policy/evaluate-policy.js";
import { printOutput } from "./cli/output.js";
import { mcpContext } from "./utils/mcp-context.js";
import type { CommandHandler, OptionValue } from "./cli/commands/types.js";
import { devices } from "./cli/commands/devices.js";
import { boards, boardInfo } from "./cli/commands/boards.js";
import { init, project, clean, test } from "./cli/commands/project.js";
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
import { asString, asBoolean } from "./cli/args.js";

export const COMMANDS: Record<string, CommandHandler> = {
  devices,
  boards,
  "board-info": boardInfo,
  init,
  lib,
  project,
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
  clean --project-dir <dir> [--background]
  test --project-dir <dir> [--environment <env>] [--background]
  build --project-dir <dir> [--environment <env>] [--background] [--verbose]
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
  policy-status [--project-dir <dir>]
  approvals [--status <pending|approved|denied|expired>] [--limit <n>]
  approval-status <approval-id> [--project-dir <dir>]
  pending-approvals [--project-dir <dir>] [--limit <n>]
  approve <approval-id>
  deny <approval-id>
  dashboard [--serve] [--port <port>]
  lock status [--port <port>]
  port release --port <port> [--force]
  install --<cline|claude|vscode|antigravity|codex|codex-plugin>
  plugin validate [--require-runtime]
  logs query [--lines <n>] [--search <text>] [--task-id <id>] [--log-path <p>] [--project-dir <dir>] [--port <port>]
  logs capture --project-dir <dir> [--port <port>] [--environment <env>] [--baud-rate <n>] [--duration <seconds>] [--max-bytes <n>] [--cursor <c>]
  system-info

GLOBAL FLAGS:
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

/**
 * Maps a CLI command (plus, for commands whose handler dispatches its own
 * subcommand from `positionals[0]` — `lib`, `project`, and `logs` — that
 * first positional) to the policy action name used for risk classification.
 * Unlike `lock`/`port`, which fold into distinct hyphenated registry keys in
 * `main()` before this is called, `lib`/`project`/`logs` are each a single
 * registry entry, so this is the one place that needs to know their
 * subcommands too: a mutating one (e.g. `lib install`) must get a
 * different, higher-risk action name than a read-only one (e.g. `lib
 * search`, `project config`, `logs query`) sharing the same command word.
 * See `actionRiskLevels` in src/core/policy/default-policy.ts for the
 * per-action risk tier this feeds.
 */
export function actionForCommand(
  command: string,
  positionals: string[],
): string {
  switch (command) {
    case "devices":
      return "list_devices";
    case "boards":
      return "list_boards";
    case "init":
      return "init_project";
    case "board-info":
      return "get_board_info";
    case "system-info":
      return "system_info";
    case "lib":
      switch (positionals[0]) {
        case "install":
          return "install_library";
        case "uninstall":
          return "uninstall_library";
        case "update":
          return "update_library";
        case "list":
          return "list_installed_libraries";
        case "search":
        default:
          return "search_libraries";
      }
    case "project":
      switch (positionals[0]) {
        case "check":
          return "check_project";
        case "context":
          return "get_project_context";
        case "config":
        default:
          return "get_project_config";
      }
    case "clean":
      return "clean_project";
    case "test":
      return "run_tests";
    case "logs":
      return positionals[0] === "capture"
        ? "capture_serial_window"
        : "query_logs";
    case "build":
      return "build_project";
    case "flash":
      return "upload_firmware";
    case "upload-fs":
      return "upload_filesystem";
    case "monitor":
      return "start_monitor";
    case "target-resolve":
      return "agent_resolve_target";
    case "monitor-status":
      return "get_monitor_status";
    case "monitor-health":
      return "agent_monitor_health";
    case "monitor-stop":
      return "stop_monitor";
    case "task-status":
      // Mirrors src/mcp/tool-registry.ts, which maps check_task_status to the
      // query_logs policy action. check_task_status is not itself in the
      // default policy's allow list, so mapping to it denies every poll -- and
      // the skills instruct agents to poll this after any --background command.
      return "query_logs";
    case "task-history":
      return "list_task_history";
    case "task-cancel":
      return "cancel_task";
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
    case "lock-status":
      return "get_lock_status";
    case "port-release":
      return "release_port_claim";
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
  const actionName = actionForCommand(command, positionals);
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
      devices: "devices",
      boards: "boards",
      "board-info": "boards",
      init: "init",
      build: "build",
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
      clean: "build",
      test: "build",
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
  const args = process.argv.slice(2);
  const command = args[0];
  const knownCommands = new Set(Object.keys(COMMANDS));

  // These matched --help/--version ANYWHERE in argv, so `lib install <name>
  // --version 1.2.3` -- the form the pio-manager skill prescribes -- printed
  // the CLI's own version and installed nothing. They are global flags only
  // when they lead, or when no command was given; after a command they belong
  // to that command.
  // --help never takes a value, so it is safe to honour anywhere: `pio-agent
  // build --help` must work, and the CLI's own error messages point at it.
  // --version DOES take a value in `lib install <name> --version 1.2.3`, so it
  // is global only when it leads.
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
  // keys before the knownCommands lookup. Task 12 (Phase C) will formalise
  // this into a real subcommand registry; keep this minimal until then.
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
    // MCP server. Strip the "serve" word but keep any trailing flags (e.g.
    // --open-dashboard-on-start) so they still reach index.ts's parsing.
    process.argv = [process.argv[0], process.argv[1], ...args.slice(1)];
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
