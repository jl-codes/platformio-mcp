/** Reference crash-decoding adapter over owned serial reads and authorized immutable ELF analysis. */
import { z } from "zod";
import { SerialClientContext } from "./serial-client.js";
import {
  resolveCompatibilityProject,
  type CompatibilityProjectDefaults,
} from "./compatibility-project.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { executeProjectInspection } from "../tools/project-inspection.js";
import { decodeBacktrace } from "../tools/analysis.js";
import { extractCrash } from "../core/analysis/crash-parser.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import { PlatformIOError } from "../utils/errors.js";

/** Decode supplied text or this connection's session without treating the ELF as proof of flashed firmware. */
export async function executeDecodeCompatibility(
  client: SerialClientContext,
  input: unknown,
  defaults: CompatibilityProjectDefaults,
  caller: PolicyEvaluationContext,
  onAuthorized?: () => Promise<void>,
) {
  const params = z
    .object({
      project_dir: z.string().min(1).max(32768).nullable().optional(),
      env: z.string().min(1).max(50).nullable().optional(),
      text: z
        .string()
        .max(1024 * 1024)
        .nullable()
        .optional(),
      session_id: z.string().min(1).max(256).nullable().optional(),
      include_all_hex: z.boolean().default(false),
      approval_id: z.string().max(256).optional(),
      config_approval_id: z.string().max(256).optional(),
      read_approval_id: z.string().max(256).optional(),
      expected_elf_sha256: z
        .string()
        .regex(/^[a-fA-F0-9]{64}$/)
        .optional(),
    })
    .strict()
    .parse(input);
  const decode = async (
    text: string,
    collection?: {
      droppedLines: number;
      totalTruncatedBytes: number;
      moreAvailable: boolean;
    },
  ) => {
    if (!text.trim())
      throw new PlatformIOError(
        "Pass crash text or an owned monitor session containing output.",
        "ANALYSIS_ARGUMENT_INVALID",
      );
    const crash = extractCrash(text, params.include_all_hex);
    if (!crash.addresses.length)
      return {
        ok: false,
        error: "no_addresses",
        summary: "No crash addresses found in the supplied output.",
        causes: crash.causes,
        reset_reasons: crash.resetReasons,
      };
    const projectDir = await resolveCompatibilityProject(
      params.project_dir,
      defaults,
    );
    const guard = createPolicyRevisionGuard(projectDir);
    const configuration = await executeProjectInspection(
      "project_envs",
      { projectDir, approvalId: params.config_approval_id },
      caller,
    );
    guard();
    if (!configuration.ok || !("defaultEnvironments" in configuration))
      throw new PlatformIOError(
        "Could not resolve analysis environment.",
        "PROJECT_CONFIG_INVALID",
      );
    const environment =
      params.env ||
      configuration.defaultEnvironments[0] ||
      (configuration.envs.length === 1
        ? configuration.envs[0].name
        : undefined);
    if (
      !environment ||
      !configuration.envs.some((item) => item.name === environment)
    )
      throw new PlatformIOError(
        "Select a valid analysis environment explicitly.",
        "PROJECT_ENVIRONMENT_INVALID",
      );
    const report = await decodeBacktrace(
      {
        projectDir,
        environment,
        text,
        includeAllHex: params.include_all_hex,
        approvalId: params.approval_id,
        expectedElfSha256: params.expected_elf_sha256,
      },
      caller,
      onAuthorized,
    );
    guard();
    if (!("elf" in report))
      return {
        ok: false,
        error: "no_addresses",
        summary: "No crash addresses found.",
        causes: report.causes,
        reset_reasons: report.resetReasons,
      };
    const resolved = report.frames.filter((frame) => frame.resolved).length;
    return {
      ok: report.ok,
      summary: `${resolved}/${report.frames.length} addresses resolved against the selected ELF. Matching the flashed firmware has not been verified.`,
      causes: report.causes,
      reset_reasons: report.resetReasons,
      backtrace_corrupted: report.backtraceCorrupted,
      frames: report.frames,
      elf_path: report.elf.path,
      elf_sha256: report.elf.sha256,
      env: report.environment,
      addr2line: report.addr2line,
      flashed_firmware_verified: report.flashedFirmwareVerified,
      ...(collection
        ? {
            collection_complete:
              !collection.droppedLines &&
              !collection.totalTruncatedBytes &&
              !collection.moreAvailable,
            dropped_lines: collection.droppedLines,
            truncated_bytes: collection.totalTruncatedBytes,
          }
        : {}),
    };
  };
  if (params.session_id)
    return client.run(
      { caller, approvalId: params.read_approval_id },
      async (service, owner) => {
        const result = await service.sessions.read(owner, params.session_id!, {
          cursor: 0,
          maxLines: 10000,
          timeoutMs: 0,
        });
        return decode(
          [...result.lines, ...(result.partial ? [result.partial] : [])].join(
            "\n",
          ),
          result,
        );
      },
    );
  return decode(params.text ?? "");
}
