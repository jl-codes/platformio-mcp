import {
  AgentBuildDiagnoseParamsSchema,
  AgentFlashMonitorVerifyParamsSchema,
  AgentGenerateBoardReportParamsSchema,
  AgentGetLastReportParamsSchema,
  AgentResolveTargetParamsSchema,
  AgentSafePinAuditParamsSchema,
  AgentValidateProjectParamsSchema,
} from "../../types.js";
import { resolveTarget } from "../../core/target-resolution.js";
import {
  agentBuildDiagnose,
  agentFlashMonitorVerify,
  agentGenerateBoardReport,
  agentGetLastReport,
  agentSafePinAudit,
  agentValidateProject,
} from "../../tools/agent.js";
import {
  asString,
  asBoolean,
  asNumber,
  asCsv,
  normalizePortOption,
} from "../args.js";
import type { CommandHandler } from "./types.js";

export const targetResolve: CommandHandler = async (ctx) => {
  const params = AgentResolveTargetParamsSchema.parse({
    projectDir: asString(ctx.options["project-dir"]),
    environment: asString(ctx.options.environment),
    port: normalizePortOption(asString(ctx.options.port)),
    bindingTtlSeconds: asNumber(ctx.options["binding-ttl"]),
  });
  return resolveTarget(params);
};

export const agentValidate: CommandHandler = async (ctx) => {
  const params = AgentValidateProjectParamsSchema.parse({
    projectDir: asString(ctx.options["project-dir"]),
  });
  return agentValidateProject(params.projectDir);
};

export const agentBuildDiagnoseCmd: CommandHandler = async (ctx) => {
  const params = AgentBuildDiagnoseParamsSchema.parse({
    projectDir: asString(ctx.options["project-dir"]),
    environment: asString(ctx.options.environment),
    verbose: asBoolean(ctx.options.verbose),
    background: asBoolean(ctx.options.background),
  });
  return agentBuildDiagnose(
    params.projectDir,
    params.environment,
    params.verbose,
    params.background,
  );
};

export const agentSafePinAuditCmd: CommandHandler = async (ctx) => {
  const params = AgentSafePinAuditParamsSchema.parse({
    projectDir: asString(ctx.options["project-dir"]),
    boardId: asString(ctx.options.board),
  });
  return agentSafePinAudit(params.projectDir, params.boardId);
};

export const agentFlashMonitorVerifyCmd: CommandHandler = async (ctx) => {
  const params = AgentFlashMonitorVerifyParamsSchema.parse({
    projectDir: asString(ctx.options["project-dir"]),
    environment: asString(ctx.options.environment),
    port: normalizePortOption(asString(ctx.options.port)),
    expect_all: asCsv(ctx.options["expect-all"]),
    reject_patterns: asCsv(ctx.options["reject-patterns"]),
    timeoutSeconds: asNumber(ctx.options.timeout),
    stabilityWindowSeconds: asNumber(ctx.options["stability-window"]),
    autoBuild: asBoolean(ctx.options["auto-build"]),
  });
  return agentFlashMonitorVerify({
    projectDir: params.projectDir,
    environment: params.environment,
    port: params.port,
    expectAll: params.expect_all,
    rejectPatterns: params.reject_patterns,
    timeoutSeconds: params.timeoutSeconds,
    stabilityWindowSeconds: params.stabilityWindowSeconds,
    autoBuild: params.autoBuild,
  });
};

export const agentLastReport: CommandHandler = async (ctx) => {
  const params = AgentGetLastReportParamsSchema.parse({
    projectDir: asString(ctx.options["project-dir"]),
  });
  return agentGetLastReport(params.projectDir);
};

export const agentBoardReport: CommandHandler = async (ctx) => {
  const params = AgentGenerateBoardReportParamsSchema.parse({
    projectDir: asString(ctx.options["project-dir"]),
    boardId: asString(ctx.options.board),
  });
  return agentGenerateBoardReport(params.projectDir, params.boardId);
};
