/** Resolve installed PlatformIO debug configuration without launching its backend or GDB client. */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PlatformIOError } from "../../utils/errors.js";
import {
  validateProjectPath,
  validateEnvironmentName,
} from "../../utils/validation.js";
import { runAnalysisProcess } from "../analysis/analysis-process.js";
import { dispatchAuthorizedAction } from "../action-dispatcher.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import { parseDebugServerCommand } from "./debug-server-config.js";

// Uses Core's configuration API, as in platformio-core v6.1.18 debug/cli.py.
// Deliberately does not invoke _run, GDBClientProcess, or preload/upload helpers.
const resolutionScript = String.raw`
import contextlib, json, os, sys
with contextlib.redirect_stdout(sys.stderr):
    from platformio.project.config import ProjectConfig
    from platformio.platform.factory import PlatformFactory
    from platformio.debug.config.factory import DebugConfigFactory
    env = sys.argv[1]
    config = ProjectConfig.get_instance()
    config.validate(envs=[env])
    platform = PlatformFactory.from_env(env, autoinstall=True)
    debug = DebugConfigFactory.new(platform, config, env)
    result = dict(
        environment=env,
        debuggerPath=debug.client_executable_path,
        elfPath=debug.program_path,
        debugTool=debug.tool_name,
        server=debug.server,
        port=debug.port,
        readyPattern=debug.server_ready_pattern,
        initScript=debug.reveal_patterns(debug.get_init_script("gdb")),
        initCommands=debug.reveal_patterns(list(debug.init_cmds or [])),
        extraCommands=debug.reveal_patterns(list(debug.extra_cmds or [])),
        loadCommands=debug.reveal_patterns(list(debug.load_cmds or [])),
        initBreak=debug.init_break,
        loadMode=debug.load_mode,
    )
print(json.dumps(result, ensure_ascii=True))
`;
const boundedText = z
  .string()
  .max(65536)
  .refine((value) => !value.includes("\0"));
const commandList = z.array(boundedText).max(256);
const resolvedSchema = z
  .object({
    environment: z.string().max(50),
    debuggerPath: boundedText,
    elfPath: boundedText,
    debugTool: z.string().max(256).nullable(),
    server: z.unknown(),
    port: z.string().max(1024).nullable(),
    readyPattern: z.string().max(4096).nullable(),
    initScript: boundedText,
    initCommands: commandList,
    extraCommands: commandList,
    loadCommands: commandList,
    initBreak: boundedText.nullable(),
    loadMode: z.string().max(64),
  })
  .strict();

/** Parse the exact selected environment; scripts remain inert data needing separate host/target authorization. */
export function parseResolvedDebugConfiguration(
  output: string,
  projectDir: string,
  environment: string,
) {
  const invalid = (): never => {
    throw new PlatformIOError(
      "Invalid resolved debugger configuration.",
      "DEBUG_RESOLVED_CONFIG_INVALID",
    );
  };
  if (Buffer.byteLength(output) > 1024 * 1024) return invalid();
  let raw: unknown;
  try {
    raw = JSON.parse(output);
  } catch {
    return invalid();
  }
  const parsed = resolvedSchema.safeParse(raw);
  if (!parsed.success || parsed.data.environment !== environment)
    return invalid();
  const data = parsed.data;
  for (const file of [data.debuggerPath, data.elfPath])
    if (!path.isAbsolute(file) || /[\x00-\x1f\x7f]/.test(file))
      return invalid();
  return { ...data, server: parseDebugServerCommand(data.server, projectDir) };
}

/** Host-supplied inputs, never expose interpreter paths or system-info overrides in a public tool schema. */
export interface DebugConfigurationResolution {
  projectDir: string;
  environment: string;
  systemInfo: unknown;
  approvalId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Resolve package hooks and debug metadata under build permission; this can install packages and execute project code. */
export async function resolveDebugConfiguration(
  input: DebugConfigurationResolution,
  caller: PolicyEvaluationContext = {},
) {
  const projectDir = validateProjectPath(input.projectDir);
  if (
    !validateEnvironmentName(input.environment) ||
    input.environment.startsWith("-")
  )
    throw new PlatformIOError(
      "Select a valid debugger environment.",
      "DEBUG_ENVIRONMENT_INVALID",
    );
  const timeoutMs = input.timeoutMs ?? 90000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
    throw new PlatformIOError(
      "Debugger configuration timeout must be between 1 and 120000 ms.",
      "DEBUG_CONFIG_LIMIT_INVALID",
    );
  const info = input.systemInfo as Record<string, { value?: unknown }> | null;
  const candidate = process.env.PIO_MCP_DEBUG_PYTHON ?? info?.python_exe?.value;
  if (
    typeof candidate !== "string" ||
    !path.isAbsolute(candidate) ||
    /[\x00-\x1f\x7f]/.test(candidate) ||
    /\.(?:cmd|bat|ps1|sh)$/i.test(candidate)
  )
    throw new PlatformIOError(
      "A host-installed PlatformIO Python interpreter is required.",
      "DEBUG_PYTHON_UNAVAILABLE",
    );
  const guard = createPolicyRevisionGuard(projectDir);
  const executable = await fs.realpath(candidate);
  const project = await fs.realpath(projectDir);
  const relative = path.relative(project, executable);
  if (
    !relative ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative)) ||
    !(await fs.stat(executable)).isFile()
  )
    throw new PlatformIOError(
      "Debugger configuration Python must be installed outside the project.",
      "DEBUG_PYTHON_UNTRUSTED",
    );
  return dispatchAuthorizedAction(
    "build_project",
    {
      projectDir,
      environment: input.environment,
      executable,
      timeoutMs,
      purpose: "debugger_configuration_resolution",
      approvalId: input.approvalId,
    },
    { ...caller, workspaceDir: projectDir },
    async () => {
      guard();
      const result = await runAnalysisProcess(
        executable,
        ["-I", "-c", resolutionScript, input.environment],
        {
          cwd: projectDir,
          timeoutMs,
          maxOutputBytes: 1024 * 1024,
          signal: input.signal,
          environment: {
            PYTHONIOENCODING: "utf-8",
            PLATFORMIO_DISABLE_PROGRESSBAR: "true",
          },
        },
      );
      guard();
      return parseResolvedDebugConfiguration(
        result.stdout,
        projectDir,
        input.environment,
      );
    },
  );
}
