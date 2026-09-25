/** Shared build execution with optional parallelism, cache bypass and hardware locking. */
import { buildProject } from "../tools/build.js";
import type { BuildResult } from "../types.js";
import { hardwareLockManager } from "../utils/lock-manager.js";

/** Canonical build inputs; all new execution options are additive. */
export type BuildProjectCoreInput = {
  projectDir: string;
  environment?: string;
  verbose?: boolean;
  jobs?: number;
  forceExecution?: boolean;
  background?: boolean;
  sessionId?: string;
};

/** Preserve explicit-session or implicit hardware locking around the build engine. */
export async function buildProjectCore(
  input: BuildProjectCoreInput,
): Promise<BuildResult> {
  const executeTask = () =>
    buildProject(
      input.projectDir,
      input.environment,
      input.verbose,
      input.background,
      { jobs: input.jobs, forceExecution: input.forceExecution },
    );

  if (input.sessionId) {
    hardwareLockManager.requireLock(input.sessionId);
    return executeTask();
  }

  return hardwareLockManager.withImplicitLock(executeTask);
}
