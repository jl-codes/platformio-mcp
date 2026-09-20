/** Authorized PlatformIO metadata and size-check collection for analysis adapters. */
import { retainCommandLog } from "../../utils/command-log.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import { platformioExecutor } from "../../platformio.js";
import {
  validateProjectPath,
  validateEnvironmentName,
} from "../../utils/validation.js";
import { PlatformIOError } from "../../utils/errors.js";
import { dispatchAuthorizedAction } from "../action-dispatcher.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import { selectDebugMetadata } from "../debug/debug-discovery.js";
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

/** Opaque process-local collection capability; structurally similar caller objects are not authority. */
export interface BuildCollectionAuthorization {
  readonly projectDir: string;
  readonly environment: string;
}
const collectionAuthorities = new WeakMap<
  BuildCollectionAuthorization,
  { check: () => void; stages: Set<string> }
>();

/** Authorizes one complete analysis request and invalidates its internal capability on completion. */
export async function withAuthorizedBuildCollection<T>(
  input: BuildContextInput & {
    analysisPurpose: "decode_backtrace" | "firmware_size_report";
    requestDigest: string;
  },
  caller: PolicyEvaluationContext,
  execute: (authorization: BuildCollectionAuthorization) => Promise<T>,
): Promise<T> {
  const selected = scope(input);
  const check = createPolicyRevisionGuard(selected.projectDir);
  return dispatchAuthorizedAction(
    input.analysisPurpose === "firmware_size_report"
      ? "size_report"
      : "decode_backtrace",
    {
      ...selected,
      approvalId: input.approvalId,
      analysisPurpose: input.analysisPurpose,
      requestDigest: input.requestDigest,
    },
    { ...caller, workspaceDir: selected.projectDir },
    async () => {
      check();
      const authorization = Object.freeze({ ...selected });
      collectionAuthorities.set(authorization, {
        check,
        stages: new Set(
          input.analysisPurpose === "firmware_size_report"
            ? ["project_metadata", "check_program_size"]
            : ["project_metadata"],
        ),
      });
      try {
        return await execute(authorization);
      } finally {
        collectionAuthorities.delete(authorization);
      }
    },
  );
}

/** Runs an authorized stage once, or performs standalone authorization for legacy/internal callers. */
async function collectionStage<T>(
  input: BuildContextInput,
  args: Record<string, unknown>,
  caller: PolicyEvaluationContext,
  authorization: BuildCollectionAuthorization | undefined,
  execute: () => Promise<T>,
): Promise<T> {
  if (!authorization)
    return dispatchAuthorizedAction(
      "build_project",
      args,
      { ...caller, workspaceDir: input.projectDir },
      execute,
    );
  const state = collectionAuthorities.get(authorization);
  const purpose = String(args.analysisPurpose);
  if (
    !state ||
    authorization.projectDir !== input.projectDir ||
    authorization.environment !== input.environment ||
    !state.stages.has(purpose)
  )
    throw new PlatformIOError(
      "Analysis collection authority is invalid, expired or already used.",
      "ANALYSIS_AUTHORITY_INVALID",
    );
  state.check();
  state.stages.delete(purpose);
  return execute();
}

/** Collects fresh metadata under build permission; no process-global metadata cache is used. */
export async function collectBuildMetadata(
  input: BuildContextInput,
  caller: PolicyEvaluationContext = {},
  authorization?: BuildCollectionAuthorization,
) {
  return collectSelectedMetadata(
    input,
    caller,
    selectBuildMetadata,
    authorization,
  );
}

/** Collect the actual selected GDB/ELF metadata under a distinct build-authorized request. */
export function collectDebugMetadata(
  input: BuildContextInput,
  caller: PolicyEvaluationContext = {},
) {
  return collectSelectedMetadata(input, caller, selectDebugMetadata);
}

/** Share the bounded collection operation without granting debugger requests analysis capabilities. */
async function collectSelectedMetadata<T>(
  input: BuildContextInput,
  caller: PolicyEvaluationContext,
  select: (output: string, environment: string) => T,
  authorization?: BuildCollectionAuthorization,
): Promise<T> {
  const selected = scope(input);
  const guard = createPolicyRevisionGuard(selected.projectDir);
  return collectionStage(
    selected,
    {
      ...selected,
      approvalId: input.approvalId,
      analysisPurpose: "project_metadata",
    },
    caller,
    authorization,
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
      guard();
      return select(result.stdout, selected.environment);
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
  authorization?: BuildCollectionAuthorization,
): Promise<ProgramMemoryEvidence> {
  const selected = scope(input);
  return collectionStage(
    selected,
    {
      ...selected,
      elfPath,
      approvalId: input.approvalId,
      analysisPurpose: "check_program_size",
    },
    caller,
    authorization,
    async () => {
      const before = await readElfIdentity(elfPath);
      const result = await platformioExecutor.execute(
        "run",
        ["--environment", selected.environment, "--target", "checkprogsize"],
        { cwd: selected.projectDir, timeout: 600000 },
      );
      await readElfIdentity(elfPath, before.sha256);
      const logPath = await retainCommandLog(
        "program-size",
        result.stdout,
        result.stderr,
      );
      return {
        environment: selected.environment,
        elfSha256: before.sha256,
        exitCode: result.exitCode,
        output: result.stdout,
        logPath,
      };
    },
  );
}
