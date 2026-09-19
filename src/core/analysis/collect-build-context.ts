/** Authorized PlatformIO metadata and size-check collection for analysis adapters. */
import { platformioExecutor } from "../../platformio.js";
import {
  validateProjectPath,
  validateEnvironmentName,
} from "../../utils/validation.js";
import { PlatformIOError } from "../../utils/errors.js";
import { dispatchAuthorizedAction } from "../action-dispatcher.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import { selectBuildMetadata } from "./build-metadata.js";
import { readElfIdentity } from "./elf-identity.js";
import type { ProgramMemoryEvidence } from "./platformio-memory.js";

/** Explicit project/environment scope; approvals bind the concrete collection purpose too. */
export interface BuildContextInput {
  projectDir: string;
  environment: string;
  approvalId?: string;
}

/** Validates a single environment before any process or command ledger is created. */
function scope(input: BuildContextInput) {
  if (
    !validateEnvironmentName(input.environment) ||
    input.environment.startsWith("-")
  )
    throw new PlatformIOError(
      "Select a valid explicit build environment.",
      "ANALYSIS_ENVIRONMENT_REQUIRED",
    );
  return {
    projectDir: validateProjectPath(input.projectDir),
    environment: input.environment,
  };
}

/** Collects fresh metadata under build permission; no process-global metadata cache is used. */
export async function collectBuildMetadata(
  input: BuildContextInput,
  caller: PolicyEvaluationContext = {},
) {
  const selected = scope(input);
  return dispatchAuthorizedAction(
    "build_project",
    {
      ...selected,
      approvalId: input.approvalId,
      analysisPurpose: "project_metadata",
    },
    { ...caller, workspaceDir: selected.projectDir },
    async () => {
      const result = await platformioExecutor.execute(
        "project",
        ["metadata", "--json-output", "--environment", selected.environment],
        { cwd: selected.projectDir, timeout: 600000 },
      );
      if (result.exitCode !== 0)
        throw new PlatformIOError(
          "PlatformIO metadata collection failed.",
          "ANALYSIS_METADATA_FAILED",
        );
      return selectBuildMetadata(result.stdout, selected.environment);
    },
  );
}

/**
 * Collects board-aware size figures only if the exact ELF remains unchanged through the check.
 * checkprogsize may execute project scripts, so this is a build operation, never offline inspection.
 */
export async function collectProgramMemory(
  input: BuildContextInput,
  elfPath: string,
  caller: PolicyEvaluationContext = {},
): Promise<ProgramMemoryEvidence> {
  const selected = scope(input);
  return dispatchAuthorizedAction(
    "build_project",
    {
      ...selected,
      elfPath,
      approvalId: input.approvalId,
      analysisPurpose: "check_program_size",
    },
    { ...caller, workspaceDir: selected.projectDir },
    async () => {
      const before = await readElfIdentity(elfPath);
      const result = await platformioExecutor.execute(
        "run",
        ["--environment", selected.environment, "--target", "checkprogsize"],
        { cwd: selected.projectDir, timeout: 600000 },
      );
      await readElfIdentity(elfPath, before.sha256);
      return {
        environment: selected.environment,
        elfSha256: before.sha256,
        exitCode: result.exitCode,
        output: result.stdout,
      };
    },
  );
}
