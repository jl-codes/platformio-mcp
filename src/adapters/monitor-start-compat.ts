/** Resolve reference monitor defaults and open an owned session through canonical authorization. */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { MonitorCaptureSchema } from "../core/serial/session-policy.js";
import { SerialClientContext } from "./serial-client.js";
import {
  resolveCompatibilityProject,
  type CompatibilityProjectDefaults,
} from "./compatibility-project.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { executeProjectInspection } from "../tools/project-inspection.js";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import { listDevicesCore } from "../core/devices.js";
import { PlatformIOError } from "../utils/errors.js";

/** Separate grants cover configuration, candidate selection, identity snapshots and hardware opening. */
export const MonitorStartCompatibilitySchema = z
  .object({
    port: z.string().min(1).max(512).nullable().optional(),
    baud: z.number().int().min(1).max(4000000).nullable().optional(),
    project_dir: z.string().min(1).max(32768).nullable().optional(),
    env: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/)
      .nullable()
      .optional(),
    max_lines: z.number().int().min(1).max(10000).default(5000),
    approval_id: z.string().max(256).optional(),
    config_approval_id: z.string().max(256).optional(),
    selection_approval_id: z.string().max(256).optional(),
    discovery_approval_id: z.string().max(256).optional(),
  })
  .strict();

/** Never guess among multiple candidate devices or bypass the startup service's identity/lease checks. */
export async function resolveMonitorRequest(
  input: unknown,
  defaults: CompatibilityProjectDefaults,
  caller: PolicyEvaluationContext,
  projectDevices: (devices: Awaited<ReturnType<typeof listDevicesCore>>) => {
    likely_ports: string[];
  },
) {
  const params = MonitorStartCompatibilitySchema.parse(input);
  const useConfig = !!(params.project_dir || defaults.projectDir || params.env);
  const projectDir = useConfig
    ? await resolveCompatibilityProject(params.project_dir, defaults)
    : await fs.realpath(path.resolve(defaults.cwd ?? process.cwd()));
  let port = params.port || undefined;
  let baud = params.baud || undefined;
  let environment = params.env || undefined;
  if (useConfig) {
    const report = await executeProjectInspection(
      "project_envs",
      { projectDir, approvalId: params.config_approval_id },
      caller,
    );
    if (!report.ok || !("defaultEnvironments" in report))
      throw new PlatformIOError(
        "Could not resolve monitor project configuration.",
        "PROJECT_CONFIG_INVALID",
      );
    environment ||=
      report.defaultEnvironments[0] ||
      (report.envs.length === 1 ? report.envs[0].name : undefined);
    const selected = report.envs.find((item) => item.name === environment);
    if (environment && !selected)
      throw new PlatformIOError(
        "Monitor environment does not exist.",
        "PROJECT_ENVIRONMENT_INVALID",
      );
    if (!port) {
      const configured = selected?.monitorPort || selected?.uploadPort;
      if (configured != null && configured !== "")
        port = z.string().min(1).max(512).parse(configured);
    }
    if (
      !baud &&
      selected?.monitorSpeed != null &&
      selected.monitorSpeed !== ""
    ) {
      const speed = selected.monitorSpeed;
      if (
        typeof speed !== "number" &&
        (typeof speed !== "string" || !/^\d+$/.test(speed))
      )
        throw new PlatformIOError(
          "Invalid configured monitor speed.",
          "SERIAL_TRANSPORT_ARGUMENT_INVALID",
        );
      baud = z.number().int().min(1).max(4000000).parse(Number(speed));
    }
  }
  if (!port) {
    port = await dispatchAuthorizedAction(
      "list_devices",
      { projectDir, approvalId: params.selection_approval_id },
      { ...caller, workspaceDir: projectDir },
      async () => {
        const guard = createPolicyRevisionGuard(projectDir);
        const rows = projectDevices(await listDevicesCore());
        guard();
        if (rows.likely_ports.length !== 1)
          throw new PlatformIOError(
            rows.likely_ports.length
              ? "Several candidate ports; pass port explicitly."
              : "No likely development-board port; pass port explicitly.",
            "SERIAL_PORT_SELECTION_REQUIRED",
          );
        return rows.likely_ports[0]!;
      },
    );
  }
  const request = {
    projectDir,
    path: port,
    baudRate: baud ?? 115200,
    buffer: { maxLines: params.max_lines },
  };
  return { params, request, environment };
}

/** Resolve defaults and open one persistent owned monitor. */
export async function startCompatibilityMonitor(
  client: SerialClientContext,
  input: unknown,
  defaults: CompatibilityProjectDefaults,
  caller: PolicyEvaluationContext,
  projectDevices: Parameters<typeof resolveMonitorRequest>[3],
) {
  const { params, request } = await resolveMonitorRequest(
    input,
    defaults,
    caller,
    projectDevices,
  );
  return client.run(
    {
      caller,
      approvalId: params.approval_id,
      discoveryApprovalId: params.discovery_approval_id,
    },
    (service, owner) => service.startWithDiscovery(owner, request),
  );
}

/** Validate both phases before resolution, then use the preauthorized one-shot lifecycle. */
export async function captureCompatibilityMonitor(
  client: SerialClientContext,
  input: unknown,
  defaults: CompatibilityProjectDefaults,
  caller: PolicyEvaluationContext,
  projectDevices: Parameters<typeof resolveMonitorRequest>[3],
) {
  const schema = MonitorStartCompatibilitySchema.extend({
    ...MonitorCaptureSchema.shape,
    read_approval_id: z.string().max(256).optional(),
  });
  const { seconds, until, read_approval_id, ...start } = schema.parse(input);
  const { params, request } = await resolveMonitorRequest(
    start,
    defaults,
    caller,
    projectDevices,
  );
  return client.run(
    {
      caller,
      approvalId: params.approval_id,
      readApprovalId: read_approval_id,
      discoveryApprovalId: params.discovery_approval_id,
    },
    (service, owner) =>
      service.captureMonitorOnce(owner, request, {
        seconds,
        until,
        max_lines: start.max_lines,
      }),
  );
}
