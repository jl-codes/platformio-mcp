/** Reference size-report projection using authorized canonical ELF and board analysis. */
import { z } from "zod";
import { firmwareSizeReport } from "../tools/analysis.js";
import { executeProjectInspection } from "../tools/project-inspection.js";
import { getBoardInfo } from "../tools/boards.js";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import {
  resolveCompatibilityProject,
  type CompatibilityProjectDefaults,
} from "./compatibility-project.js";
import { PlatformIOError } from "../utils/errors.js";

/** Retain reference response keys while distinguishing board capacity from partition-aware accounting. */
export async function executeSizeCompatibility(
  input: unknown,
  defaults: CompatibilityProjectDefaults,
  caller: PolicyEvaluationContext,
  onAuthorized?: () => Promise<void>,
) {
  const params = z
    .object({
      project_dir: z.string().min(1).max(32768).nullable().optional(),
      env: z.string().min(1).max(50).nullable().optional(),
      top: z.number().int().min(1).max(1000).default(25),
      filter: z.string().max(4096).nullable().optional(),
      approval_id: z.string().max(256).optional(),
      config_approval_id: z.string().max(256).optional(),
      board_approval_id: z.string().max(256).optional(),
      expected_elf_sha256: z
        .string()
        .regex(/^[a-fA-F0-9]{64}$/)
        .optional(),
    })
    .strict()
    .parse(input);
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
      "Could not resolve size-report environment.",
      "PROJECT_CONFIG_INVALID",
    );
  const environment =
    params.env ||
    configuration.defaultEnvironments[0] ||
    (configuration.envs.length === 1 ? configuration.envs[0].name : undefined);
  const selected = configuration.envs.find((item) => item.name === environment);
  if (!environment || !selected)
    throw new PlatformIOError(
      "Select a valid size-report environment.",
      "PROJECT_ENVIRONMENT_INVALID",
    );
  const boardId =
    typeof selected.board === "string" ? selected.board : undefined;
  const board = boardId
    ? await dispatchAuthorizedAction(
        "get_board_info",
        { boardId, projectDir, approvalId: params.board_approval_id },
        { ...caller, workspaceDir: projectDir },
        () => getBoardInfo(boardId),
      )
    : undefined;
  guard();
  const report = await firmwareSizeReport(
    {
      projectDir,
      environment,
      top: params.top,
      filter: params.filter || undefined,
      approvalId: params.approval_id,
      expectedElfSha256: params.expected_elf_sha256,
    },
    caller,
    onAuthorized,
  );
  guard();
  const percent = (used: number, capacity?: number) =>
    capacity && capacity > 0 ? Math.round((1000 * used) / capacity) / 10 : null;
  const region = (value: NonNullable<typeof report.memory>["flash"]) => ({
    used_bytes: value.usedBytes,
    total_bytes: value.totalBytes,
    percent: value.percent,
  });
  const regionTotals: Record<string, number> = {};
  for (const section of report.sections)
    regionTotals[section.region] =
      (regionTotals[section.region] ?? 0) + section.size;
  return {
    ok: report.ok,
    summary: `${environment}: ${report.totals.flashEstimate} B estimated flash, ${report.totals.ramEstimate} B estimated static RAM. Heap and stack are excluded; memory_source identifies measured build accounting versus estimates.`,
    env: environment,
    elf_path: report.elf.path,
    elf_sha256: report.elf.sha256,
    board: board
      ? {
          board: board.id,
          flash_bytes: board.rom ?? null,
          ram_bytes: board.ram ?? null,
          mcu: board.mcu,
        }
      : {},
    totals: {
      text: report.totals.text,
      data: report.totals.data,
      bss: report.totals.bss,
      flash_estimate: report.totals.flashEstimate,
      ram_estimate: report.totals.ramEstimate,
    },
    memory: report.memory
      ? { flash: region(report.memory.flash), ram: region(report.memory.ram) }
      : {},
    memory_source: report.memorySource,
    memory_log_path: report.memoryLogPath,
    memory_unavailable_reason: report.memoryUnavailableReason,
    flash_percent:
      report.memory?.flash.percent ??
      percent(report.totals.flashEstimate, board?.rom),
    ram_percent:
      report.memory?.ram.percent ??
      percent(report.totals.ramEstimate, board?.ram),
    region_totals: regionTotals,
    sections: report.sections.slice(0, 40),
    top_symbols: report.topSymbols,
    symbol_count: report.symbolCount,
    top_files: report.topFiles,
    filter: params.filter ?? null,
    notes: report.notes,
  };
}
