/** Adapt pinned project inspection vocabulary to the existing authorized canonical services. */
import { executeTestCompatibility } from "./test-compat.js";
import {
  executeBuildCompatibility,
  executeCheckCompatibility,
  executeCleanCompatibility,
} from "./clean-compat.js";
import { executeInitCompatibility } from "./init-compat.js";
import path from "node:path";
import { z } from "zod";
import {
  resolveCompatibilityProject,
  type CompatibilityProjectDefaults,
} from "./compatibility-project.js";
import { executeProjectInspection } from "../tools/project-inspection.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { PlatformIOError } from "../utils/errors.js";

const text = z
  .string()
  .max(4096)
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value));
const scope = {
  project_dir: text.nullable().optional(),
  approval_id: text.optional(),
};
const schemas = {
  pio_project_envs: z.object(scope).strict(),
  pio_list_targets: z
    .object({ ...scope, env: text.nullable().optional() })
    .strict(),
  pio_project_metadata: z
    .object({ ...scope, env: text.nullable().optional() })
    .strict(),
};
/** Validate reference arguments before resolving project state or invoking canonical authorization. */
export async function mapProjectCompatibilityRequest(
  name: string,
  input: unknown,
  defaults: CompatibilityProjectDefaults = {},
) {
  if (!Object.hasOwn(schemas, name))
    throw new PlatformIOError(
      "Unknown project compatibility tool.",
      "COMPAT_TOOL_UNKNOWN",
    );
  const parsed = schemas[name as keyof typeof schemas].safeParse(input);
  if (!parsed.success)
    throw new PlatformIOError(
      "Invalid project compatibility arguments.",
      "COMPAT_ARGUMENT_INVALID",
    );
  return {
    action:
      name === "pio_project_envs"
        ? ("project_envs" as const)
        : name === "pio_list_targets"
          ? ("list_targets" as const)
          : ("project_metadata" as const),
    args: {
      projectDir: await resolveCompatibilityProject(
        parsed.data.project_dir,
        defaults,
      ),
      ...("env" in parsed.data && parsed.data.env
        ? { environment: parsed.data.env }
        : {}),
      ...(parsed.data.approval_id
        ? { approvalId: parsed.data.approval_id }
        : {}),
    },
  };
}
/** Preserve failures and project identity while projecting bounded canonical data into reference fields. */
export function projectCompatibilityResult(
  result: Awaited<ReturnType<typeof executeProjectInspection>>,
) {
  const common = {
    ok: result.ok,
    summary: result.summary,
    project_dir: result.projectDir,
    log_path: null,
  };
  if (!result.ok)
    return {
      ...common,
      error:
        "error" in result && result.error
          ? result.error
          : "PROJECT_INSPECTION_FAILED",
      output_tail: "outputTail" in result ? result.outputTail : "",
    };
  if ("targets" in result && result.targets)
    return { ...common, targets: result.targets };
  if ("defaultEnvironments" in result)
    return {
      ...common,
      default_envs: result.defaultEnvironments,
      platformio_section: result.platformioSection,
      platformio_ini_path: path.join(result.projectDir, "platformio.ini"),
      envs: result.envs.map((item) => ({
        name: item.name,
        board: item.board,
        platform: item.platform,
        framework: item.framework,
        monitor_speed: item.monitorSpeed,
        monitor_port: item.monitorPort,
        upload_port: item.uploadPort,
        upload_protocol: item.uploadProtocol,
        lib_deps: item.libraryDependencies,
        build_flags: item.buildFlags,
        extends: item.extends,
      })),
    };
  if ("envs" in result && result.envs && !Array.isArray(result.envs))
    return {
      ...common,
      envs: Object.fromEntries(
        Object.entries(result.envs).map(([name, item]) => [
          name,
          {
            build_type: item.buildType,
            defines: item.defines,
            include_dirs: item.includeDirs,
            toolchain_include_dirs_count: item.toolchainIncludeDirCount,
            libsource_dirs: item.librarySourceDirs,
            cc: item.cc,
            cxx: item.cxx,
            cxx_flags: item.cxxFlags,
            program_path: item.programPath,
            extra: item.extra,
          },
        ]),
      ),
    };
  throw new PlatformIOError(
    "Unexpected project compatibility result.",
    "COMPAT_RESULT_INVALID",
  );
}
/** Execute through the shared canonical dispatcher; aliases never provide a separate policy grant. */
export async function executeProjectCompatibility(
  name: string,
  input: unknown,
  defaults: CompatibilityProjectDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  if (name === "pio_test")
    return executeTestCompatibility(input, defaults, caller, onAuthorized);
  if (name === "pio_check")
    return executeCheckCompatibility(input, defaults, caller, onAuthorized);
  if (name === "pio_build")
    return executeBuildCompatibility(input, defaults, caller, onAuthorized);
  if (name === "pio_clean")
    return executeCleanCompatibility(input, defaults, caller, onAuthorized);
  if (name === "pio_project_init")
    return executeInitCompatibility(input, defaults, caller, onAuthorized);
  const request = await mapProjectCompatibilityRequest(name, input, defaults);
  return projectCompatibilityResult(
    await executeProjectInspection(
      request.action,
      request.args,
      caller,
      onAuthorized,
    ),
  );
}
