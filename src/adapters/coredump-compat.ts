/** Reference core-dump workflow delegates acquisition, retention and analysis to authorized canonical actions. */
import fs from "node:fs/promises";
import { z } from "zod";
import { executeCoredump } from "../tools/coredump.js";
import { resolveTargetSerialSelection } from "../tools/run-target.js";
import { collectBuildMetadata } from "../core/analysis/collect-build-context.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import {
  resolveCompatibilityProject,
  type CompatibilityProjectDefaults,
} from "./compatibility-project.js";

/** Reference arguments plus explicit grants for independently authorized effects. */
export const CoredumpCompatibilitySchema = z
  .object({
    project_dir: z.string().max(32768).nullish(),
    env: z
      .string()
      .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,49}$/)
      .nullish(),
    port: z.string().min(1).max(512).nullish(),
    out_path: z.string().min(1).max(32768).nullish(),
    analyze: z.boolean().default(true),
    elf_path: z.string().min(1).max(32768).optional(),
    table_path: z.string().min(1).max(32768).optional(),
    table_offset: z.number().int().nonnegative().max(0xfffff000).optional(),
    sdkconfig_path: z.string().min(1).max(32768).optional(),
    build_metadata: z.boolean().default(true),
    approval_id: z.string().max(256).optional(),
    config_approval_id: z.string().max(256).optional(),
    selection_approval_id: z.string().max(256).optional(),
    elf_metadata_approval_id: z.string().max(256).optional(),
    table_approval_id: z.string().max(256).optional(),
    table_config_approval_id: z.string().max(256).optional(),
    metadata_approval_id: z.string().max(256).optional(),
    system_approval_id: z.string().max(256).optional(),
    board_approval_id: z.string().max(256).optional(),
    read_approval_id: z.string().max(256).optional(),
    read_command_approval_id: z.string().max(256).optional(),
    command_approval_id: z.string().max(256).optional(),
    export_approval_id: z.string().max(256).optional(),
  })
  .strict();

/** Save every acquired partition; missing build output never masquerades as completed analysis. */
export async function executeCoredumpCompatibility(
  input: unknown,
  defaults: CompatibilityProjectDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const params = CoredumpCompatibilitySchema.parse(input);
  const projectDir = await resolveCompatibilityProject(
    params.project_dir,
    defaults,
  );
  const guard = createPolicyRevisionGuard(projectDir);
  const selected = await resolveTargetSerialSelection(
    projectDir,
    params.env ?? undefined,
    {
      config_approval_id: params.config_approval_id,
      selection_approval_id: params.selection_approval_id,
    },
    { ...caller, workspaceDir: projectDir },
    params.port ?? undefined,
  );
  guard();
  let elfPath = params.elf_path;
  let missingElf = false;
  if (params.analyze && !elfPath) {
    const metadata = await collectBuildMetadata(
      {
        projectDir,
        environment: selected.environment,
        approvalId: params.elf_metadata_approval_id,
      },
      caller,
    );
    guard();
    try {
      await fs.access(metadata.elfPath);
      elfPath = metadata.elfPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missingElf = true;
    }
  }
  const result = await executeCoredump(
    {
      projectDir,
      analyze: params.analyze && !missingElf,
      elfPath,
      outPath: params.out_path ?? undefined,
      retainDump: !params.out_path,
      approvalId: params.approval_id,
      commandApprovalId: params.command_approval_id,
      exportApprovalId: params.export_approval_id,
      device: {
        port: selected.port,
        approvalId: params.read_approval_id,
        commandApprovalId: params.read_command_approval_id,
        table: {
          projectDir,
          environment: selected.environment,
          tablePath: params.table_path,
          tableOffset: params.table_offset,
          sdkconfigPath: params.sdkconfig_path,
          buildMetadata: params.build_metadata,
          approvalId: params.table_approval_id,
          configApprovalId: params.table_config_approval_id,
          metadataApprovalId: params.metadata_approval_id,
          systemApprovalId: params.system_approval_id,
          boardApprovalId: params.board_approval_id,
        },
      },
    },
    caller,
    onAuthorized,
  );
  guard();
  return {
    ...result,
    error: !result.ok ? "coredump_empty" : undefined,
    env: result.layout?.environment ?? selected.environment,
    port: result.acquisition?.port ?? selected.port,
    partition: result.acquisition
      ? {
          name: result.acquisition.partition,
          type: "data",
          subtype: "coredump",
          offset: result.acquisition.offset,
          size: result.acquisition.length,
        }
      : null,
    csv_path:
      result.layout?.table_source === "metadata:extra.flash_images"
        ? null
        : (result.layout?.table.path ?? null),
    dump_path: result.dump_export?.path ?? null,
    dump_bytes: result.dump_export?.size ?? null,
    read_log_path: result.acquisition?.logPath ?? null,
    elf_path: elfPath ?? null,
    gdb: result.analyzed ? result.debugger : null,
    analyzer_available: result.analyzed
      ? true
      : "analysis_unavailable" in result && result.analysis_unavailable
        ? false
        : null,
    analysis: result.analyzed
      ? {
          ok: result.ok,
          exit_code: 0,
          output: result.output,
          crashed_task: result.crashed_task,
          reason: result.reason,
          registers: result.registers,
          backtrace: result.backtrace,
        }
      : null,
    summary: !result.ok
      ? "No recorded core dump; raw partition saved."
      : result.analyzed
        ? "Core dump saved and analyzed against the selected ELF."
        : missingElf
          ? "Core dump saved; build the matching ELF to analyze it."
          : "Core dump saved without analysis.",
  };
}
