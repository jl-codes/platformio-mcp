/** Reference partition arguments delegate to the canonical permission-controlled implementation. */
import { z } from "zod";
import { executePartitionTable } from "../tools/partition-table.js";
import { resolveTargetSerialSelection } from "../tools/run-target.js";
import {
  resolveCompatibilityProject,
  type CompatibilityProjectDefaults,
} from "./compatibility-project.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";

const schema = z
  .object({
    project_dir: z.string().max(32768).nullish(),
    env: z
      .string()
      .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,49}$/)
      .nullish(),
    read_device: z.boolean().default(false),
    port: z.string().min(1).max(512).nullish(),
    build_metadata: z.boolean().default(true),
    table_path: z.string().min(1).max(32768).optional(),
    table_offset: z.number().int().nonnegative().max(0xfffff000).optional(),
    sdkconfig_path: z.string().min(1).max(32768).optional(),
    firmware_path: z.string().min(1).max(32768).optional(),
    approval_id: z.string().max(256).optional(),
    config_approval_id: z.string().max(256).optional(),
    metadata_approval_id: z.string().max(256).optional(),
    system_approval_id: z.string().max(256).optional(),
    board_approval_id: z.string().max(256).optional(),
    selection_approval_id: z.string().max(256).optional(),
    read_approval_id: z.string().max(256).optional(),
    command_approval_id: z.string().max(256).optional(),
  })
  .strict();

/** Preserve reference names/defaults while exposing build/device grants and actual artifact provenance. */
export async function executePartitionCompatibility(
  input: unknown,
  defaults: CompatibilityProjectDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const params = schema.parse(input);
  const projectDir = await resolveCompatibilityProject(
    params.project_dir,
    defaults,
  );
  let environment = params.env ?? undefined;
  let port = params.port ?? undefined;
  if (params.read_device && !port) {
    const selected = await resolveTargetSerialSelection(
      projectDir,
      environment,
      {
        config_approval_id: params.config_approval_id,
        selection_approval_id: params.selection_approval_id,
      },
      { ...caller, workspaceDir: projectDir },
    );
    environment = selected.environment;
    port = selected.port;
  }
  const result = await executePartitionTable(
    {
      projectDir,
      environment,
      tablePath: params.table_path,
      tableOffset: params.table_offset,
      sdkconfigPath: params.sdkconfig_path,
      firmwarePath: params.firmware_path,
      buildMetadata: params.build_metadata,
      readDevice: params.read_device,
      port,
      approvalId: params.approval_id,
      configApprovalId: params.config_approval_id,
      metadataApprovalId: params.metadata_approval_id,
      systemApprovalId: params.system_approval_id,
      boardApprovalId: params.board_approval_id,
      readApprovalId: params.read_approval_id,
      commandApprovalId: params.command_approval_id,
    },
    caller,
    onAuthorized,
  );
  const binary = result.table_source === "metadata:extra.flash_images";
  return {
    ...result,
    env: result.environment,
    csv_path: binary ? null : result.artifacts.table.path,
    csv_source: binary ? null : result.table_source,
    effective_table_path: result.artifacts.table.path,
    effective_table_format: binary ? "binary" : "csv",
    flash_size_source: result.flash_size_source,
    firmware_bin: result.artifacts.firmware?.path ?? null,
    device: result.device ?? {},
  };
}
