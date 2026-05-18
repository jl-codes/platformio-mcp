import { buildProject } from "../tools/build.js";
import type { BuildResult } from "../types.js";
import { hardwareLockManager } from "../utils/lock-manager.js";

export type BuildProjectCoreInput = {
  projectDir: string;
  environment?: string;
  verbose?: boolean;
  background?: boolean;
  sessionId?: string;
};

export async function buildProjectCore(
  input: BuildProjectCoreInput,
): Promise<BuildResult> {
  const executeTask = () =>
    buildProject(
      input.projectDir,
      input.environment,
      input.verbose,
      input.background,
    );

  if (input.sessionId) {
    hardwareLockManager.requireLock(input.sessionId);
    return executeTask();
  }

  return hardwareLockManager.withImplicitLock(executeTask);
}
