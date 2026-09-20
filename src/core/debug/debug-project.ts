/** Compose authorized debug firmware preparation and trusted artifact/tool selection before probe acquisition. */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { platformioExecutor } from "../../platformio.js";
import { getSystemInfo } from "../../tools/projects.js";
import { hardwareLockManager } from "../../utils/lock-manager.js";
import { PlatformIOError } from "../../utils/errors.js";
import { dispatchAuthorizedAction } from "../action-dispatcher.js";
import { readElfIdentity } from "../analysis/elf-identity.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import { collectDebugConfiguration } from "./debug-configuration.js";
import { resolveDebugConfiguration } from "./debug-resolved-config.js";
import {
  discoverDebuggerRoots,
  resolveDebuggerExecutable,
} from "./debug-discovery.js";

const preparationSchema = z
  .object({
    projectDir: z.string().min(1).max(32768),
    environment: z
      .string()
      .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,49}$/)
      .optional(),
    timeoutMs: z.number().int().min(1).max(600000).default(90000),
    configApprovalId: z.string().max(256).optional(),
    buildApprovalId: z.string().max(256).optional(),
    systemApprovalId: z.string().max(256).optional(),
    resolutionApprovalId: z.string().max(256).optional(),
    imageApprovalId: z.string().max(256).optional(),
  })
  .strict();

/** Build debug firmware without starting an interface; select an exact ELF identity for later immutable retention. */
export async function prepareDebuggerProject(
  input: unknown,
  caller: PolicyEvaluationContext = {},
  signal?: AbortSignal,
) {
  const parsed = preparationSchema.safeParse(input);
  if (!parsed.success)
    throw new PlatformIOError(
      "Invalid debugger preparation arguments.",
      "DEBUG_ARGUMENT_INVALID",
    );
  const args = parsed.data;
  const projectDir = await fs.realpath(args.projectDir);
  const context = { ...caller, workspaceDir: projectDir };
  const guard = createPolicyRevisionGuard(projectDir);
  const deadline = performance.now() + args.timeoutMs;
  const remaining = () => {
    guard();
    if (signal?.aborted)
      throw new PlatformIOError(
        "Debugger preparation cancelled.",
        "DEBUG_CANCELLED",
      );
    const duration = Math.floor(deadline - performance.now());
    if (duration < 1)
      throw new PlatformIOError(
        "Debugger preparation exceeded its deadline.",
        "DEBUG_PREPARATION_TIMEOUT",
      );
    return duration;
  };
  remaining();
  const selected = await collectDebugConfiguration(
    {
      projectDir,
      environment: args.environment,
      approvalId: args.configApprovalId,
    },
    context,
  );
  remaining();
  return hardwareLockManager.withImplicitLock(async () => {
    remaining();
    await dispatchAuthorizedAction(
      "build_project",
      {
        projectDir,
        environment: selected.environment,
        purpose: "debugger_build",
        approvalId: args.buildApprovalId,
      },
      context,
      async () => {
        // Core's no-interface debug command calls predebug_project with preload=False.
        // Never add --interface=gdb here: probe/backend ownership is established later.
        const result = await platformioExecutor.execute(
          "debug",
          ["--environment", selected.environment],
          { cwd: projectDir, timeout: remaining() },
        );
        remaining();
        if (result.exitCode !== 0)
          throw new PlatformIOError(
            "Debug firmware preparation failed.",
            "DEBUG_BUILD_FAILED",
            { environment: selected.environment, exitCode: result.exitCode },
          );
      },
    );
    const systemInfo = await dispatchAuthorizedAction(
      "system_info",
      {
        projectDir,
        purpose: "debugger_tools",
        approvalId: args.systemApprovalId,
      },
      context,
      async () => {
        remaining();
        return getSystemInfo();
      },
    );
    remaining();
    const configuration = await resolveDebugConfiguration(
      {
        projectDir,
        environment: selected.environment,
        systemInfo,
        timeoutMs: Math.min(120000, args.timeoutMs),
        deadline,
        signal,
        approvalId: args.resolutionApprovalId,
      },
      context,
    );
    remaining();
    const trustedDebuggerRoots = await discoverDebuggerRoots(
      configuration.debuggerPath,
      systemInfo,
      projectDir,
    );
    const executable = await resolveDebuggerExecutable(
      configuration.debuggerPath,
      trustedDebuggerRoots,
      projectDir,
    );
    remaining();
    const identity = await dispatchAuthorizedAction(
      "get_project_config",
      {
        projectDir,
        environment: selected.environment,
        purpose: "debugger_image_identity",
        elfPath: configuration.elfPath,
        approvalId: args.imageApprovalId,
      },
      context,
      async () => {
        remaining();
        const file = await fs.realpath(configuration.elfPath);
        const relative = path.relative(projectDir, file);
        if (
          !relative ||
          relative === ".." ||
          relative.startsWith(".." + path.sep) ||
          path.isAbsolute(relative)
        )
          throw new PlatformIOError(
            "Debugger ELF must belong to the authorized project.",
            "DEBUG_ELF_OUTSIDE_WORKSPACE",
          );
        const result = await readElfIdentity(file);
        remaining();
        return result;
      },
    );
    remaining();
    return {
      projectDir,
      environment: selected.environment,
      configuration,
      executable,
      trustedDebuggerRoots,
      elfPath: identity.path,
      expectedElfSha256: identity.sha256,
      firmwareIdentity: identity,
    };
  });
}
