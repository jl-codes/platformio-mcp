/** Select the reference debugger environment from computed Core configuration under read authorization. */
import { platformioExecutor } from "../../platformio.js";
import { PlatformIOError } from "../../utils/errors.js";
import {
  validateProjectPath,
  validateEnvironmentName,
} from "../../utils/validation.js";
import { parseProjectEnvironments } from "../project-inspection.js";
import { dispatchAuthorizedAction } from "../action-dispatcher.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../policy/types.js";

/** Selected computed options are configuration data, never authority to execute debugger scripts. */
export interface SelectedDebugConfiguration {
  environment: string;
  debugTool: string | null;
  buildType: string | null;
}

/** Prefer an explicit environment, then a debug default, then the first default as in the pinned reference. */
export function selectDebugConfiguration(
  output: string,
  environment?: string,
): SelectedDebugConfiguration {
  const view = parseProjectEnvironments(output);
  // The shared parser already bounds and validates every section and rejects duplicates.
  const raw = JSON.parse(output) as Array<[string, Array<[string, unknown]>]>;
  const environments = new Map(
    raw
      .filter(([name]) => name.startsWith("env:"))
      .map(([name, fields]) => [name.slice(4), Object.fromEntries(fields)]),
  );
  const selected =
    environment ??
    view.defaultEnvironments.find(
      (name) => environments.get(name)?.build_type === "debug",
    ) ??
    view.defaultEnvironments[0];
  if (
    !selected ||
    !validateEnvironmentName(selected) ||
    selected.startsWith("-") ||
    !environments.has(selected)
  )
    throw new PlatformIOError(
      "Select one valid debugger environment.",
      "DEBUG_ENVIRONMENT_INVALID",
    );
  const options = environments.get(selected)!;
  const setting = (name: string): string | null => {
    const value = options[name];
    if (value == null) return null;
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 256 ||
      /[\x00-\x1f\x7f]/.test(value)
    )
      throw new PlatformIOError(
        "Invalid computed debugger configuration.",
        "DEBUG_CONFIG_INVALID",
      );
    return value;
  };
  return {
    environment: selected,
    debugTool: setting("debug_tool"),
    buildType: setting("build_type"),
  };
}

/** Read computed configuration without launching a build, GDB, backend, or probe operation. */
export async function collectDebugConfiguration(
  input: {
    projectDir: string;
    environment?: string;
    approvalId?: string;
    deadline?: number; // Host-owned monotonic deadline; excluded from approval identity.
  },
  caller: PolicyEvaluationContext = {},
): Promise<SelectedDebugConfiguration> {
  const projectDir = validateProjectPath(input.projectDir);
  if (
    input.environment !== undefined &&
    (!validateEnvironmentName(input.environment) ||
      input.environment.startsWith("-"))
  )
    throw new PlatformIOError(
      "Select one valid debugger environment.",
      "DEBUG_ENVIRONMENT_INVALID",
    );
  if (input.deadline !== undefined && !Number.isFinite(input.deadline))
    throw new PlatformIOError(
      "Invalid debugger configuration deadline.",
      "DEBUG_CONFIG_LIMIT_INVALID",
    );
  const remaining = () => {
    const timeout =
      input.deadline === undefined
        ? 30000
        : Math.min(30000, Math.floor(input.deadline - performance.now()));
    if (timeout < 1)
      throw new PlatformIOError(
        "Debugger configuration deadline expired.",
        "DEBUG_PREPARATION_TIMEOUT",
      );
    return timeout;
  };
  remaining();
  const guard = createPolicyRevisionGuard(projectDir);
  return dispatchAuthorizedAction(
    "get_project_config",
    {
      projectDir,
      environment: input.environment,
      approvalId: input.approvalId,
      purpose: "debugger_configuration",
    },
    { ...caller, workspaceDir: projectDir },
    async () => {
      guard();
      const result = await platformioExecutor.execute(
        "project",
        ["config", "--json-output"],
        { cwd: projectDir, timeout: remaining() },
      );
      guard();
      remaining();
      if (result.exitCode !== 0)
        throw new PlatformIOError(
          "Debugger configuration collection failed.",
          "DEBUG_CONFIG_FAILED",
        );
      return selectDebugConfiguration(result.stdout, input.environment);
    },
  );
}
