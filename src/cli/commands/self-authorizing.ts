/**
 * Commands that authorise themselves.
 *
 * Every other CLI command is pre-authorised by src/cli.ts (one policy
 * evaluation for the command's operation, then the handler). The commands
 * here instead evaluate policy per sub-step inside their own executors --
 * a core-dump read authorises the flash read and the export separately, a
 * package install authorises the registry query and the mutation -- and
 * resolve approvals interactively through withInteractiveApprovals. So the
 * generic pre-check must NOT run for them: it would either double-prompt or
 * deny an operation the executor was about to ask about more precisely.
 *
 * The bodies are upstream's, moved out of src/cli.ts verbatim: each prints
 * its own result, sets the exit code on `ok: false`, and returns true once
 * it has handled the command. A false return means "not one of mine".
 */
import fs from "node:fs";
import { parseSerialObservationCli } from "../../adapters/serial-observation-cli.js";
import { executeDeviceCompatibility } from "../../adapters/device-compat.js";
import {
  parseDebugRunCli,
  executeDebugRunCli,
} from "../../adapters/debug-run-cli.js";
import { parseOtaCli } from "../../adapters/ota-cli.js";
import { executeOtaCompatibility } from "../../adapters/ota-compat.js";
import { parsePowerProfileCli } from "../../adapters/power-profile-cli.js";
import { executePowerCompatibility } from "../../adapters/power-compat.js";
import { PowerMeterClient } from "../../adapters/power-meter-client.js";
import { withInteractiveApprovals } from "../../core/policy/interactive-approvals.js";
import { parseFlashVerificationCli } from "../../adapters/flash-verification-cli.js";
import { executeFlashVerificationCompatibility } from "../../adapters/flash-verification-compat.js";
import { executeCoredump } from "../../tools/coredump.js";
import { executePartitionTable } from "../../tools/partition-table.js";
import { executeRunTargetAction } from "../../tools/run-target.js";
import { SerialClientContext } from "../../adapters/serial-client.js";
import { inspectDependencies } from "../../tools/dependency-inspection.js";
import {
  executeProjectInspection,
  type ProjectInspectionAction,
} from "../../tools/project-inspection.js";
import {
  executePackageAction,
  type PackageAction,
} from "../../tools/packages.js";
import { decodeBacktrace, firmwareSizeReport } from "../../tools/analysis.js";
import {
  enrollProjectPolicy,
  revokeProjectPolicy,
} from "../../core/policy/project-enrollment.js";
import { dispatchAuthorizedAction } from "../../core/action-dispatcher.js";
import { approveRequest } from "../../core/policy/approvals.js";
import { PlatformIOError } from "../../utils/errors.js";
import { printOutput } from "../output.js";
import { promptApproval } from "../prompt.js";
import { asString, asBoolean } from "../args.js";
import type { CommandContext } from "./types.js";

export const SELF_AUTHORIZING_COMMANDS = new Set([
  "coredump",
  "partition-table",
  "monitor-capture",
  "memory-watch",
  "port-diagnose",
  "debug-run",
  "upload-ota",
  "power-profile",
  "flash-verify",
  "run-target",
  "policy-enroll",
  "policy-revoke",
  "deps-check",
  "decode-backtrace",
  "size-report",
  "pkg-search",
  "pkg-install",
  "pkg-uninstall",
  "pkg-list",
  "pkg-outdated",
  "pkg-update",
  "project-envs",
  "project-metadata",
  "list-targets",
]);

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

/**
 * Runs `command` if it is self-authorising. Returns false when it is not,
 * so src/cli.ts falls through to the pre-authorised registry.
 */
export async function runSelfAuthorizingCommand(
  command: string,
  ctx: CommandContext,
): Promise<boolean> {
  const { options, positionals, jsonMode } = ctx;
  const projectDirForPolicy = asString(options["project-dir"]);
  const approvalOpt = asBoolean(options.approve);
  const projectInspection = [
    "project-envs",
    "project-metadata",
    "list-targets",
  ].includes(command);

  if (command === "coredump") {
    const allowed = new Set([
      "retain-dump",
      "out-path",
      "export-approval-id",
      "json",
      "project-dir",
      "dump-path",
      "format",
      "analyze",
      "elf-path",
      "expected-input-sha256",
      "expected-elf-sha256",
      "encrypted",
      "approval-id",
      "command-approval-id",
      "port",
      "partition-name",
      "table-path",
      "table-format",
      "table-offset",
      "sdkconfig-path",
      "environment",
      "flash-size",
      "build-metadata",
      "table-approval-id",
      "config-approval-id",
      "metadata-approval-id",
      "system-approval-id",
      "board-approval-id",
      "read-approval-id",
      "read-command-approval-id",
    ]);
    if (
      positionals.length ||
      Object.keys(options).some((key) => !allowed.has(key))
    )
      throw new PlatformIOError(
        "Unknown core-dump option or positional argument.",
        "COREDUMP_INPUT_INVALID",
      );
    for (const key of ["analyze", "encrypted", "build-metadata", "retain-dump"])
      if (
        options[key] !== undefined &&
        ![true, false, "true", "false"].includes(options[key])
      )
        throw new PlatformIOError(
          "Expected true or false for --" + key,
          "COREDUMP_INPUT_INVALID",
        );
    const port = asString(options.port);
    const deviceOptions = [
      "partition-name",
      "table-path",
      "table-format",
      "table-offset",
      "sdkconfig-path",
      "environment",
      "flash-size",
      "build-metadata",
      "table-approval-id",
      "config-approval-id",
      "metadata-approval-id",
      "system-approval-id",
      "board-approval-id",
      "read-approval-id",
      "read-command-approval-id",
    ];
    if (!port && deviceOptions.some((key) => options[key] !== undefined))
      throw new PlatformIOError(
        "Device/table options require --port.",
        "COREDUMP_INPUT_INVALID",
      );
    const integerOption = (key: string) => {
      const value = asString(options[key]);
      if (value === undefined) return undefined;
      if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value))
        throw new PlatformIOError(
          "Expected integer bytes for --" + key,
          "COREDUMP_INPUT_INVALID",
        );
      return Number(value);
    };
    const device = port
      ? {
          port,
          partitionName: asString(options["partition-name"]),
          approvalId: asString(options["read-approval-id"]),
          commandApprovalId: asString(options["read-command-approval-id"]),
          table: {
            projectDir: projectDirForPolicy,
            tablePath: asString(options["table-path"]),
            format: asString(options["table-format"]),
            tableOffset: integerOption("table-offset"),
            sdkconfigPath: asString(options["sdkconfig-path"]),
            environment: asString(options.environment),
            flashSize: integerOption("flash-size"),
            buildMetadata: asBoolean(options["build-metadata"]) ?? false,
            approvalId: asString(options["table-approval-id"]),
            configApprovalId: asString(options["config-approval-id"]),
            metadataApprovalId: asString(options["metadata-approval-id"]),
            systemApprovalId: asString(options["system-approval-id"]),
            boardApprovalId: asString(options["board-approval-id"]),
          },
        }
      : undefined;
    const result = await executeCoredump(
      {
        device,
        retainDump: asBoolean(options["retain-dump"]) ?? false,
        outPath: asString(options["out-path"]),
        exportApprovalId: asString(options["export-approval-id"]),
        projectDir: projectDirForPolicy,
        dumpPath: asString(options["dump-path"]),
        format: asString(options.format),
        analyze: asBoolean(options.analyze) ?? true,
        elfPath: asString(options["elf-path"]),
        encrypted: asBoolean(options.encrypted) ?? false,
        expectedInputSha256: asString(options["expected-input-sha256"]),
        expectedElfSha256: asString(options["expected-elf-sha256"]),
        approvalId: asString(options["approval-id"]),
        commandApprovalId: asString(options["command-approval-id"]),
      },
      { workspaceDir: projectDirForPolicy, actor: "user" },
    );
    printOutput(result, jsonMode);
    if (!result.ok) process.exitCode = 1;
    return true;
  }
  if (command === "partition-table") {
    const allowed = new Set([
      "json",
      "project-dir",
      "table-path",
      "format",
      "table-offset",
      "sdkconfig-path",
      "read-device",
      "port",
      "read-approval-id",
      "command-approval-id",
      "build-metadata",
      "metadata-approval-id",
      "system-approval-id",
      "board-approval-id",
      "environment",
      "config-approval-id",
      "flash-size",
      "firmware-path",
      "observed-table-path",
      "approval-id",
    ]);
    if (
      positionals.length ||
      Object.keys(options).some((key) => !allowed.has(key))
    )
      throw new PlatformIOError(
        "Unknown partition inspection argument.",
        "PARTITION_INPUT_INVALID",
      );
    if (
      options["read-device"] !== undefined &&
      ![true, false, "true", "false"].includes(options["read-device"])
    )
      throw new PlatformIOError(
        "--read-device must be true or false.",
        "PARTITION_INPUT_INVALID",
      );
    if (
      options["build-metadata"] !== undefined &&
      ![true, false, "true", "false"].includes(options["build-metadata"])
    )
      throw new PlatformIOError(
        "--build-metadata must be true or false.",
        "PARTITION_INPUT_INVALID",
      );
    const numberOption = (key: string) => {
      const value = asString(options[key]);
      if (value === undefined) return undefined;
      if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value))
        throw new PlatformIOError(
          "Expected integer bytes for --" + key,
          "PARTITION_INPUT_INVALID",
        );
      return Number(value);
    };
    const result = await executePartitionTable(
      {
        projectDir: projectDirForPolicy,
        tablePath: asString(options["table-path"]),
        format: asString(options.format),
        tableOffset: numberOption("table-offset"),
        sdkconfigPath: asString(options["sdkconfig-path"]),
        readDevice: asBoolean(options["read-device"]) ?? false,
        port: asString(options.port),
        readApprovalId: asString(options["read-approval-id"]),
        commandApprovalId: asString(options["command-approval-id"]),
        buildMetadata: asBoolean(options["build-metadata"]) ?? false,
        metadataApprovalId: asString(options["metadata-approval-id"]),
        systemApprovalId: asString(options["system-approval-id"]),
        boardApprovalId: asString(options["board-approval-id"]),
        environment: asString(options.environment),
        configApprovalId: asString(options["config-approval-id"]),
        flashSize: numberOption("flash-size"),
        firmwarePath: asString(options["firmware-path"]),
        observedTablePath: asString(options["observed-table-path"]),
        approvalId: asString(options["approval-id"]),
      },
      { workspaceDir: projectDirForPolicy, actor: "user" },
    );
    printOutput(result, jsonMode);
    if (!result.ok) process.exitCode = 1;
    return true;
  }
  if (
    command === "monitor-capture" ||
    command === "memory-watch" ||
    command === "port-diagnose"
  ) {
    const input = parseSerialObservationCli(
      command,
      options,
      positionals,
      projectDirForPolicy,
    );
    const client = new SerialClientContext();
    const operation =
      command === "monitor-capture"
        ? "monitor_capture"
        : command === "memory-watch"
          ? "memory_watch"
          : "port_diagnose";
    const caller = {
      workspaceDir: projectDirForPolicy,
      actor: "user" as const,
    };
    try {
      const execute = () =>
        dispatchAuthorizedAction(operation, input, caller, () =>
          executeDeviceCompatibility(
            client,
            "pio_" + operation,
            input,
            {},
            caller,
          ),
        );
      const result =
        approvalOpt === true || (!jsonMode && approvalOpt !== false)
          ? await withInteractiveApprovals(
              async (request) =>
                approvalOpt === true || promptApproval(request.reason),
              execute,
            )
          : await execute();
      printOutput(result, jsonMode);
      if (!(result as { ok?: boolean }).ok) process.exitCode = 1;
    } finally {
      const sessions = await client.close();
      if (sessions.some((session) => session.cleanupPending))
        throw new PlatformIOError(
          "Serial cleanup remains pending.",
          "SERIAL_CLI_CLEANUP_PENDING",
        );
    }
    return true;
  }
  if (command === "debug-run") {
    const input = parseDebugRunCli(options, positionals, projectDirForPolicy);
    const execute = () =>
      executeDebugRunCli(input, {
        workspaceDir: projectDirForPolicy,
        actor: "user",
      });
    const result =
      approvalOpt === true || (!jsonMode && approvalOpt !== false)
        ? await withInteractiveApprovals(
            async (request) =>
              approvalOpt === true || promptApproval(request.reason),
            execute,
          )
        : await execute();
    printOutput(result, jsonMode);
    if (!result.ok) process.exitCode = 1;
    return true;
  }
  if (command === "upload-ota") {
    const input = parseOtaCli(options, positionals, projectDirForPolicy);
    const execute = () =>
      executeOtaCompatibility(
        input,
        {},
        {
          workspaceDir: projectDirForPolicy,
          actor: "user",
        },
      );
    const result =
      approvalOpt === true || (!jsonMode && approvalOpt !== false)
        ? await withInteractiveApprovals(
            async (request) =>
              approvalOpt === true || promptApproval(request.reason),
            execute,
          )
        : await execute();
    printOutput(result, jsonMode);
    if (!result.ok) process.exitCode = 1;
    return true;
  }
  if (command === "power-profile") {
    const input = parsePowerProfileCli(
      options,
      positionals,
      projectDirForPolicy,
    );
    const serial = new SerialClientContext();
    const meter = new PowerMeterClient();
    try {
      const execute = () =>
        executePowerCompatibility(
          serial,
          meter,
          input,
          {},
          {
            workspaceDir: projectDirForPolicy,
            actor: "user",
          },
          "power_profile",
        );
      const result =
        approvalOpt === true || (!jsonMode && approvalOpt !== false)
          ? await withInteractiveApprovals(
              async (request) =>
                approvalOpt === true || promptApproval(request.reason),
              execute,
            )
          : await execute();
      printOutput(result, jsonMode);
      if (!result.ok) process.exitCode = 1;
    } finally {
      const closed = await Promise.allSettled([meter.close(), serial.close()]);
      const failure = closed.find((entry) => entry.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    }
    return true;
  }
  if (command === "flash-verify") {
    const input = parseFlashVerificationCli(
      options,
      positionals,
      projectDirForPolicy,
    );
    const client = new SerialClientContext();
    try {
      const execute = () =>
        executeFlashVerificationCompatibility(
          input,
          client,
          {},
          {
            workspaceDir: projectDirForPolicy,
            actor: "user",
          },
        );
      const result =
        approvalOpt === true || (!jsonMode && approvalOpt !== false)
          ? await withInteractiveApprovals(
              async (request) =>
                approvalOpt === true || promptApproval(request.reason),
              execute,
            )
          : await execute();
      printOutput(result, jsonMode);
      if (!result.ok) process.exitCode = 1;
    } finally {
      await client.close();
    }
    return true;
  }
  if (command === "run-target") {
    const allowed = new Set([
      "json",
      "project-dir",
      "target",
      "environment",
      "upload-port",
      "stop-open-sessions",
      "approval-id",
      "config-approval-id",
      "selection-approval-id",
    ]);
    if (
      positionals.length ||
      Object.keys(options).some((key) => !allowed.has(key))
    )
      throw new PlatformIOError(
        "Unknown named-target option or positional argument.",
        "TARGET_INPUT_INVALID",
      );
    if (
      options["stop-open-sessions"] !== undefined &&
      ![true, false, "true", "false"].includes(options["stop-open-sessions"])
    )
      throw new PlatformIOError(
        "--stop-open-sessions must be true or false.",
        "TARGET_INPUT_INVALID",
      );
    const client = new SerialClientContext();
    try {
      const result = await executeRunTargetAction(
        {
          projectDir: projectDirForPolicy,
          target: asString(options.target),
          environment: asString(options.environment),
          uploadPort: asString(options["upload-port"]),
          stopOpenSessions: asBoolean(options["stop-open-sessions"]) ?? false,
          approvalId: asString(options["approval-id"]),
          configApprovalId: asString(options["config-approval-id"]),
          selectionApprovalId: asString(options["selection-approval-id"]),
        },
        client,
        { workspaceDir: projectDirForPolicy, actor: "user" },
      );
      printOutput(result, jsonMode);
      if (!result.ok) process.exitCode = 1;
    } finally {
      await client.close();
    }
    return true;
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
    return true;
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
        configurationApprovalId: asString(options["configuration-approval-id"]),
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
    return true;
  }

  return false;
}
