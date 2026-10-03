import {
  AgentMonitorHealthParamsSchema,
  GetMonitorStatusParamsSchema,
  StartMonitorParamsSchema,
} from "../../types.js";
import {
  startMonitorCore,
  waitForExpectedSerialOutput,
} from "../../core/monitor.js";
import { getMonitorStatus, stopMonitor } from "../../tools/monitor.js";
import { agentMonitorHealth } from "../../tools/agent.js";
import { PlatformIOError } from "../../utils/errors.js";
import { printOutput } from "../output.js";
import {
  asString,
  asBoolean,
  asNumber,
  asCsv,
  normalizePortOption,
} from "../args.js";
import type { CommandHandler } from "./types.js";

export const monitor: CommandHandler = async (ctx) => {
  const { options, jsonMode } = ctx;
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
};

export const monitorStatus: CommandHandler = async (ctx) => {
  const params = GetMonitorStatusParamsSchema.parse({
    projectDir: asString(ctx.options["project-dir"]),
    port: normalizePortOption(asString(ctx.options.port)),
  });
  return getMonitorStatus(params.port, params.projectDir);
};

export const monitorStop: CommandHandler = async (ctx) => {
  const port = asString(ctx.options.port);
  if (!port) {
    throw new PlatformIOError(
      "monitor-stop requires --port <port>",
      "MISSING_ARGUMENT",
      { argument: "port" },
    );
  }
  // stopMonitor() itself returns void (its callers elsewhere only cared
  // about the side effect). Every CLI command needs to emit something on
  // success though, so wrap its result in a small confirmation payload
  // rather than leaving --json callers with empty stdout.
  await stopMonitor(port, asString(ctx.options["project-dir"]));
  return { success: true, port };
};

export const monitorHealth: CommandHandler = async (ctx) => {
  const params = AgentMonitorHealthParamsSchema.parse({
    projectDir: asString(ctx.options["project-dir"]),
    environment: asString(ctx.options.environment),
    port: normalizePortOption(asString(ctx.options.port)),
    baudRate: asNumber(ctx.options["baud-rate"]),
    captureDurationSeconds: asNumber(ctx.options.duration),
    maxBytes: asNumber(ctx.options["max-bytes"]),
    expectedMarkers: asCsv(ctx.options["expect-all"]),
    rejectedPatterns: asCsv(ctx.options["reject-patterns"]),
    automationKey: asString(ctx.options["automation-key"]),
    cursor: asString(ctx.options.cursor),
    failureThreshold: asNumber(ctx.options["failure-threshold"]),
  });
  return agentMonitorHealth(params);
};
