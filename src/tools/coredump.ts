/** Permission-gated offline core-dump handler shared by MCP and CLI adapters. */
import fs from "node:fs/promises";
import { z } from "zod";
import { PlatformIOError } from "../utils/errors.js";
import {
  dispatchAuthorizedAction,
  planAction,
} from "../core/action-dispatcher.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { readEspCoredumpArtifact } from "../core/analysis/esp-coredump-artifact.js";
import { analyzeEspCoredump } from "../core/analysis/esp-coredump-debugger.js";
import { resolveEspCoredumpTools } from "../core/analysis/esp-coredump-tools.js";

/** Explicit offline artifacts only; live flash acquisition is separately authorized. */
export const CoredumpSchema = z
  .object({
    projectDir: z.string().min(1).max(32768),
    dumpPath: z.string().min(1).max(32768),
    format: z.enum(["raw", "base64"]).default("raw"),
    analyze: z.boolean().default(true),
    elfPath: z.string().min(1).max(32768).optional(),
    expectedInputSha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
    expectedElfSha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
    encrypted: z.boolean().default(false),
    approvalId: z.string().max(256).optional(),
    commandApprovalId: z.string().max(256).optional(),
  })
  .strict()
  .refine(
    (value) => !value.analyze || !!value.elfPath,
    "An explicit ELF is required for analysis.",
  );

/** Preflight both grants before consuming either; no artifact bytes are returned or logged. */
export async function executeCoredump(
  input: unknown,
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const request = CoredumpSchema.parse(input);
  const projectDir = await fs.realpath(request.projectDir);
  const { commandApprovalId, ...operation } = request;
  const args = { ...operation, projectDir };
  const commandArgs = { ...args, approvalId: commandApprovalId };
  const context = { ...caller, workspaceDir: projectDir };
  const stages: Array<[string, Record<string, unknown>]> = [
    ["coredump_inspect", args],
  ];
  if (request.analyze) stages.push(["coredump_analyze", commandArgs]);
  for (const [name, parameters] of stages) {
    const plan = await planAction(name, parameters, context);
    if (plan.status !== "ready")
      throw new PlatformIOError(
        plan.reason,
        plan.status === "requires_approval"
          ? "APPROVAL_REQUIRED"
          : "POLICY_DENIED",
        { policyDecision: plan },
      );
  }
  return dispatchAuthorizedAction(
    "coredump_inspect",
    args,
    context,
    async () => {
      const validatePolicy = createPolicyRevisionGuard(projectDir);
    await onAuthorized?.();
      validatePolicy();
      const selection = { ...request, workspaceDir: projectDir };
      if (!request.analyze) {
        const artifact = await readEspCoredumpArtifact(selection);
        validatePolicy();
        return {
          ok: true as const,
          analyzed: false as const,
          source: artifact.source,
          identity: artifact.identity,
          firmwareIdentity: artifact.firmwareIdentity,
        };
      }
      return dispatchAuthorizedAction(
        "coredump_analyze",
        commandArgs,
        context,
        async () => {
          validatePolicy();
          const tools = await resolveEspCoredumpTools(projectDir);
          const result = await analyzeEspCoredump(
            { ...selection, elfPath: request.elfPath!, validatePolicy },
            { ...tools, validatePolicy },
          );
          validatePolicy();
          return { ...result, analyzed: true as const };
        },
      );
    },
  );
}
