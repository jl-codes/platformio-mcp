/** Validated firmware analysis handlers shared by future MCP/CLI compatibility adapters. */
import fs from "node:fs/promises";
import { z } from "zod";
import { getSystemInfo } from "./projects.js";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import {
  collectBuildMetadata,
  collectProgramMemory,
} from "../core/analysis/collect-build-context.js";
import { discoverAnalysisToolchainRoots } from "../core/analysis/toolchain-discovery.js";
import { readElfIdentity } from "../core/analysis/elf-identity.js";
import {
  decodeFirmwareCrash,
  reportFirmwareSize,
  type FirmwareAnalysisContext,
} from "../core/analysis/firmware-analysis.js";

const analysisScope = {
  projectDir: z.string().min(1),
  environment: z.string().min(1).max(50),
  approvalId: z.string().optional(),
  expectedElfSha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
};
/** No compiler paths or trusted roots may be supplied by public analysis arguments. */
export const DecodeBacktraceParamsSchema = z
  .object({
    ...analysisScope,
    text: z
      .string()
      .min(1)
      .refine(
        (value) => Buffer.byteLength(value) <= 1024 * 1024,
        "Crash text exceeds 1 MiB",
      ),
    includeAllHex: z.boolean().optional(),
  })
  .strict();
/** Symbol filters are explicit regular expressions, evaluated by bounded workers. */
export const FirmwareSizeParamsSchema = z
  .object({
    ...analysisScope,
    top: z.number().int().min(1).max(1000).default(25),
    filter: z.string().max(4096).optional(),
  })
  .strict();

/** Resolves fresh build identity and trusted host tools; project scripts require build permission. */
async function resolveContext(
  input:
    | z.infer<typeof FirmwareSizeParamsSchema>
    | z.infer<typeof DecodeBacktraceParamsSchema>,
  caller: PolicyEvaluationContext,
): Promise<FirmwareAnalysisContext> {
  const projectDir = await fs.realpath(input.projectDir);
  const selected = {
    projectDir,
    environment: input.environment,
    approvalId: input.approvalId,
  };
  const metadata = await collectBuildMetadata(selected, caller);
  const systemInfo = await dispatchAuthorizedAction(
    "system_info",
    { projectDir },
    { ...caller, workspaceDir: projectDir },
    getSystemInfo,
  );
  const trustedToolchainRoots = await discoverAnalysisToolchainRoots(
    metadata.compilerPath,
    systemInfo,
    projectDir,
  );
  const identity = await readElfIdentity(
    metadata.elfPath,
    input.expectedElfSha256,
  );
  return {
    projectDir,
    ...metadata,
    trustedToolchainRoots,
    expectedElfSha256: identity.sha256,
  };
}

/** Decodes a supplied crash log against the explicitly selected build environment. */
export async function decodeBacktrace(
  input: unknown,
  caller: PolicyEvaluationContext = {},
) {
  const params = DecodeBacktraceParamsSchema.parse(input);
  const context = await resolveContext(params, caller);
  return decodeFirmwareCrash(context, params.text, params.includeAllHex);
}

/** Produces one size report from matching fresh metadata, ELF and board accounting. */
export async function firmwareSizeReport(
  input: unknown,
  caller: PolicyEvaluationContext = {},
) {
  const params = FirmwareSizeParamsSchema.parse(input);
  const context = await resolveContext(params, caller);
  context.memoryEvidence = await collectProgramMemory(
    {
      projectDir: context.projectDir,
      environment: context.environment,
      approvalId: params.approvalId,
    },
    context.elfPath,
    caller,
  );
  return reportFirmwareSize(context, params.top, params.filter);
}
