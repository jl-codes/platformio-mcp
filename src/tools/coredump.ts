/** Permission-gated offline core-dump handler shared by MCP and CLI adapters. */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { exportEspCoredump } from "../core/analysis/esp-coredump-export.js";
import { z } from "zod";
import { PlatformIOError } from "../utils/errors.js";
import {
  dispatchAuthorizedAction,
  planAction,
} from "../core/action-dispatcher.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { acquireProjectCoredump } from "./coredump-device.js";
import { PartitionTableSchema } from "./partition-table.js";
import {
  inspectCapturedEspCoredump,
  readEspCoredumpArtifact,
} from "../core/analysis/esp-coredump-artifact.js";
import { analyzeEspCoredump } from "../core/analysis/esp-coredump-debugger.js";
import { resolveEspCoredumpTools } from "../core/analysis/esp-coredump-tools.js";

/** Explicit offline artifacts only; live flash acquisition is separately authorized. */
export const CoredumpSchema = z
  .object({
    projectDir: z.string().min(1).max(32768),
    dumpPath: z.string().min(1).max(32768).optional(),
    device: z
      .object({
        port: z.string().min(1).max(512),
        partitionName: z.string().min(1).max(16).optional(),
        table: PartitionTableSchema,
        approvalId: z.string().max(256).optional(),
        commandApprovalId: z.string().max(256).optional(),
      })
      .strict()
      .optional(),
    format: z.enum(["raw", "base64"]).default("raw"),
    analyze: z.boolean().default(true),
    outPath: z.string().min(1).max(32768).optional(),
    exportApprovalId: z.string().max(256).optional(),
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
    (value) => !value.outPath || !!value.device,
    "Dump export requires device acquisition.",
  )
  .refine(
    (value) => Boolean(value.dumpPath) !== Boolean(value.device),
    "Select exactly one dump file or device acquisition.",
  )
  .refine(
    (value) =>
      !value.device ||
      (value.format === "raw" &&
        !value.encrypted &&
        !value.device.table.readDevice),
    "Device capture requires raw unencrypted input and an offline project table.",
  )
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
  if (
    request.device &&
    (await fs.realpath(request.device.table.projectDir)) !== projectDir
  )
    throw new PlatformIOError(
      "Partition inspection must use the same authorized project.",
      "COREDUMP_TABLE_INPUT_INVALID",
    );
  const { commandApprovalId, exportApprovalId, ...operation } = request;
  const stripGrants = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "approvalId" && !key.endsWith("ApprovalId"))
        .map(([key, nested]) => [key, stripGrants(nested)]),
    );
  };
  const args = {
    ...operation,
    device: stripGrants(operation.device),
    projectDir,
  };
  const commandArgs = { ...args, approvalId: commandApprovalId };
  const exportArgs = { ...args, approvalId: exportApprovalId };
  const context = { ...caller, workspaceDir: projectDir };
  const stages: Array<[string, Record<string, unknown>]> = [
    ["coredump_inspect", args],
  ];
  if (request.outPath) stages.push(["coredump_export", exportArgs]);
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
      const selection = {
        ...request,
        workspaceDir: projectDir,
        dumpPath: request.dumpPath ?? "",
      };
      const execute = async () => {
        validatePolicy();
        const tools = request.analyze
          ? await resolveEspCoredumpTools(projectDir)
          : null;
        const capture = request.device
          ? await acquireProjectCoredump(
              request.device.table,
              {
                port: request.device.port,
                partitionName: request.device.partitionName,
                approvalId: request.device.approvalId,
                commandApprovalId: request.device.commandApprovalId,
              },
              caller,
            )
          : null;
        validatePolicy();
        if (
          capture &&
          request.expectedInputSha256 &&
          createHash("sha256").update(capture.bytes).digest("hex") !==
            request.expectedInputSha256.toLowerCase()
        )
          throw new PlatformIOError(
            "Captured partition does not match the selected input identity.",
            "COREDUMP_IDENTITY_MISMATCH",
          );
        const exported =
          request.outPath && capture
            ? await dispatchAuthorizedAction(
                "coredump_export",
                exportArgs,
                context,
                () =>
                  exportEspCoredump(
                    projectDir,
                    request.outPath!,
                    capture.bytes,
                  ),
              )
            : null;
        validatePolicy();
        if (capture && !capture.present)
          return {
            ok: false as const,
            analyzed: false as const,
            error: "no_coredump",
            acquisition: capture.source,
            layout: capture.layout,
            dump_export: exported,
          };
        const capturedBytes = capture?.present ? capture.bytes : undefined;
        if (!request.analyze) {
          const artifact = capturedBytes
            ? inspectCapturedEspCoredump(
                capturedBytes,
                request.expectedInputSha256,
              )
            : await readEspCoredumpArtifact(selection);
          validatePolicy();
          return {
            ok: true as const,
            analyzed: false as const,
            source: artifact.source,
            identity: artifact.identity,
            firmwareIdentity: artifact.firmwareIdentity,
            acquisition: capture?.source ?? null,
            layout: capture?.layout ?? null,
            dump_export: exported,
          };
        }
        const result = await analyzeEspCoredump(
          { ...selection, elfPath: request.elfPath!, validatePolicy },
          { ...tools!, validatePolicy },
          capturedBytes,
        );
        validatePolicy();
        return {
          ...result,
          analyzed: true as const,
          acquisition: capture?.source ?? null,
          layout: capture?.layout ?? null,
          dump_export: exported,
        };
      };
      return request.analyze
        ? dispatchAuthorizedAction(
            "coredump_analyze",
            commandArgs,
            context,
            execute,
          )
        : execute();
    },
  );
}
