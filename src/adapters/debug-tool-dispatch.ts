/** Authorize canonical and reference debugger names over one connection-owned implementation. */
import { z } from "zod";
import { PlatformIOError } from "../utils/errors.js";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import {
  DebugStartCompatibilitySchema,
  type DebugCompatibilityClient,
} from "./debug-compat.js";
import {
  DebugCommandCompatibilitySchema,
  DebugStopCompatibilitySchema,
  DebugListCompatibilitySchema,
} from "./debug-session-compat.js";
import {
  resolveCompatibilityProject,
  type CompatibilityProjectDefaults,
} from "./compatibility-project.js";

const operations = {
  debug_start: "pio_debug_start",
  pio_debug_start: "pio_debug_start",
  debug_cmd: "pio_debug_cmd",
  pio_debug_cmd: "pio_debug_cmd",
  debug_list: "pio_debug_list",
  pio_debug_list: "pio_debug_list",
  debug_stop: "pio_debug_stop",
  pio_debug_stop: "pio_debug_stop",
} as const;
/** Only registered fixed names can select this dispatcher. */
export function isDebugToolName(name: string): name is keyof typeof operations {
  return Object.hasOwn(operations, name);
}
function parseRequest(
  operation: (typeof operations)[keyof typeof operations],
  input: unknown,
) {
  try {
    const { request_approval_id, ...raw } = z.record(z.unknown()).parse(input);
    const approvalId = z
      .string()
      .min(1)
      .max(256)
      .optional()
      .parse(request_approval_id);
    const params =
      operation === "pio_debug_start"
        ? DebugStartCompatibilitySchema.parse(raw)
        : operation === "pio_debug_cmd"
          ? DebugCommandCompatibilitySchema.parse(raw)
          : operation === "pio_debug_stop"
            ? DebugStopCompatibilitySchema.parse(raw)
            : DebugListCompatibilitySchema.parse(raw);
    return { params, approvalId };
  } catch (error) {
    if (error instanceof z.ZodError)
      throw new PlatformIOError(
        "Invalid debugger arguments.",
        "COMPAT_ARGUMENT_INVALID",
      );
    throw error;
  }
}
/** Public-name approval supplements, and cannot replace, each command's host/target permissions. */
export async function executeDebugTool(
  client: DebugCompatibilityClient,
  name: keyof typeof operations,
  input: unknown,
  defaults: CompatibilityProjectDefaults,
  caller: PolicyEvaluationContext,
) {
  const operation = operations[name];
  const { params, approvalId } = parseRequest(operation, input);
  // Closing owned processes cannot authorize target commands and must remain available after policy changes.
  if (
    operation === "pio_debug_stop" &&
    "process_only" in params &&
    params.process_only
  )
    return client.execute(operation, params, caller);
  const projectDir =
    operation === "pio_debug_start"
      ? await resolveCompatibilityProject(
          "project_dir" in params
            ? z.string().nullish().parse(params.project_dir)
            : undefined,
          defaults,
        )
      : "session_id" in params
        ? client.projectForSession(z.string().uuid().parse(params.session_id))
        : caller.workspaceDir;
  const scope = Object.fromEntries(
    Object.entries(params).filter(([key]) => !key.endsWith("approval_id")),
  );
  return dispatchAuthorizedAction(
    name,
    { ...scope, projectDir, approvalId },
    { ...caller, workspaceDir: projectDir },
    async () =>
      operation === "pio_debug_start"
        ? client.start(params, defaults, caller)
        : client.execute(operation, params, caller),
  );
}
