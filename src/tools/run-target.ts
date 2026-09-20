/**
 * Execute named PlatformIO targets with effect-based policy and caller-owned monitor cleanup.
 * Physical target adapters supply an already resolved serial port; discovery remains separately authorized.
 */
import { z } from "zod";
import { inspectPortDiagnostics } from "../core/devices/port-diagnostics.js";
import {
  planAction,
  dispatchAuthorizedAction,
} from "../core/action-dispatcher.js";
import { executeProjectInspection } from "./project-inspection.js";
import { listDevicesCore } from "../core/devices.js";
import { projectCompatibilityDevices } from "../adapters/device-compat.js";
import {
  classifyTargetEffects,
  dispatchAuthorizedTarget,
} from "../core/target-effects.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { SerialClientContext } from "../adapters/serial-client.js";
import { resolveSerialEndpoint } from "../core/devices/serial-endpoint.js";
import { hardwareLockManager } from "../utils/lock-manager.js";
import { readCommandOutput, retainCommandLog } from "../utils/command-log.js";
import { PlatformIOError } from "../utils/errors.js";
import { buildTarget } from "./build.js";
import { cleanCompatibilityResult } from "../adapters/clean-compat.js";
import {
  resolveCompatibilityProject,
  type CompatibilityProjectDefaults,
} from "../adapters/compatibility-project.js";

/** Exact target request; a session ID or caller-selected owner never grants device access. */
export const RunTargetSchema = z
  .object({
    target: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[^-\x00-\x1f\x7f][^\x00-\x1f\x7f]*$/),
    project_dir: z.string().max(32768).nullable().optional(),
    env: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,50}$/)
      .nullable()
      .optional(),
    upload_port: z.string().min(1).max(512).nullable().optional(),
    stop_open_sessions: z.boolean().default(false),
    approval_id: z.string().max(256).optional(),
    config_approval_id: z.string().max(256).optional(),
    selection_approval_id: z.string().max(256).optional(),
  })
  .strict();

/** Authorize before stopping monitors or spawning, and preserve cleanup uncertainty on failure. */
export async function executeNamedTarget(
  input: unknown,
  client: SerialClientContext,
  defaults: CompatibilityProjectDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const request = RunTargetSchema.parse(input);
  const projectDir = await resolveCompatibilityProject(
    request.project_dir,
    defaults,
  );
  const effects = classifyTargetEffects(request.target);
  const initialArgs = {
    projectDir,
    target: request.target,
    environment: request.env ?? undefined,
    uploadPort: request.upload_port ?? undefined,
    stopOpenSessions: request.stop_open_sessions,
  };
  const plan = await planAction(effects.operation, initialArgs, {
    ...caller,
    workspaceDir: projectDir,
  });
  if (plan.status === "deny")
    throw new PlatformIOError(plan.reason, "POLICY_DENIED");
  let environment = request.env ?? undefined;
  let uploadPort = request.upload_port ?? undefined;
  if (effects.deviceAccess === "write" && !uploadPort) {
    const selection = await resolveTargetSerialSelection(
      projectDir,
      environment,
      request,
      caller,
    );
    environment = selection.environment;
    uploadPort = selection.port;
  }
  return dispatchAuthorizedTarget(
    request.target,
    {
      projectDir,
      environment,
      uploadPort,
      stopOpenSessions: request.stop_open_sessions,
      approvalId: request.approval_id,
    },
    { ...caller, workspaceDir: projectDir },
    async (effects) => {
      const guard = createPolicyRevisionGuard(projectDir);
      await onAuthorized?.();
      guard();
      const endpoint = uploadPort
        ? resolveSerialEndpoint(uploadPort)
        : undefined;
      const stopped: string[] = [];
      return hardwareLockManager.withImplicitLock(async () => {
        guard();
        if (effects.deviceAccess !== "none") {
          await client.run({ caller }, async (service, owner) => {
            const held = service.sessions.list(owner).filter((session) => {
              if (
                ["stopped", "disconnected", "error"].includes(session.state) &&
                !session.cleanupPending
              )
                return false;
              if (!endpoint) return session.projectDir === projectDir;
              return (
                resolveSerialEndpoint(session.path).resource.identity ===
                endpoint.resource.identity
              );
            });
            if (held.length && !request.stop_open_sessions)
              throw new PlatformIOError(
                "An owned monitor holds the target port; stop it or set stop_open_sessions.",
                "TARGET_PORT_BUSY",
              );
            for (const session of held) {
              guard();
              const result = await service.sessions.stop(
                owner,
                session.sessionId,
              );
              if (result.cleanupPending)
                throw new PlatformIOError(
                  "Monitor closure is not confirmed.",
                  "DEVICE_CLEANUP_PENDING",
                  { cleanupPending: true },
                );
              stopped.push(session.sessionId);
            }
          });
        }
        endpoint?.revalidate();
        guard();
        const started = performance.now();
        let completed:
          | { exitCode: number; output: string; logPath: string }
          | undefined;
        const collect = async (exitCode: number, fullLogPath: string) => {
          const output = await readCommandOutput(fullLogPath);
          return {
            exitCode,
            output,
            logPath: await retainCommandLog("target", output, ""),
          };
        };
        let timedOut = false;
        try {
          await buildTarget(projectDir, request.target, environment, false, {
            uploadPort,
            serialPort: endpoint?.canonicalPort,
            timeoutMs: effects.deviceAccess === "write" ? 180000 : 1200000,
            onResult: async (result) => {
              completed = await collect(result.exitCode, result.fullLogPath);
            },
          });
        } catch (error) {
          if (
            error instanceof PlatformIOError &&
            error.code === "COMMAND_TIMEOUT" &&
            error.context?.cleanupPending === false &&
            typeof error.context.fullLogPath === "string"
          ) {
            timedOut = true;
            completed = await collect(-1, error.context.fullLogPath);
          } else throw error;
        }
        guard();
        if (!completed)
          throw new PlatformIOError(
            "Named target returned no completed result.",
            "TARGET_RESULT_MISSING",
          );
        const report = {
          ...cleanCompatibilityResult(
            completed,
            environment,
            (performance.now() - started) / 1000,
            timedOut,
            "target-" + request.target,
          ),
          ...(effects.deviceAccess !== "none"
            ? { stopped_sessions: stopped }
            : {}),
        };
        if (
          !report.ok &&
          report.port_error &&
          effects.deviceAccess !== "none"
        ) {
          const diagnosis = await diagnoseTargetPortFailure(
            uploadPort,
            report.port_error,
            projectDir,
            caller,
          );
          guard();
          return {
            ...report,
            error: report.port_error,
            port_diagnosis: diagnosis,
            summary:
              "Target failed (" + report.port_error + "): " + diagnosis.hint,
          };
        }
        return report;
      });
    },
  );
}

/** Resolve omitted serial destinations with separate configuration/discovery permissions. */
export async function resolveTargetSerialSelection(
  projectDir: string,
  environment: string | undefined,
  grants: { config_approval_id?: string; selection_approval_id?: string },
  caller: PolicyEvaluationContext,
  explicitPort?: string,
): Promise<{ environment: string; port: string }> {
  const guard = createPolicyRevisionGuard(projectDir);
  const report = await executeProjectInspection(
    "project_envs",
    {
      projectDir,
      approvalId: grants.config_approval_id,
    },
    caller,
  );
  guard();
  if (!report.ok || !("defaultEnvironments" in report))
    throw new PlatformIOError(
      "Cannot resolve target environment.",
      "TARGET_ENVIRONMENT_INVALID",
    );
  const selected =
    environment ??
    report.defaultEnvironments[0] ??
    (report.envs.length === 1 ? report.envs[0].name : undefined);
  const config = report.envs.find((entry) => entry.name === selected);
  if (!config)
    throw new PlatformIOError(
      "Select one target environment explicitly.",
      "TARGET_ENVIRONMENT_REQUIRED",
    );
  if (explicitPort || config.uploadPort) {
    const port = z
      .string()
      .min(1)
      .max(512)
      .regex(/^[^\x00-\x1f\x7f]+$/)
      .parse(explicitPort ?? config.uploadPort);
    // Network/glob destinations need their own ownership adapter, not a fake serial lease.
    resolveSerialEndpoint(port);
    return { environment: config.name, port };
  }
  const port = await dispatchAuthorizedAction(
    "list_devices",
    {
      projectDir,
      approvalId: grants.selection_approval_id,
    },
    { ...caller, workspaceDir: projectDir },
    async () => {
      const candidates = projectCompatibilityDevices(
        await listDevicesCore(),
      ).likely_ports;
      guard();
      if (candidates.length !== 1)
        throw new PlatformIOError(
          "No unique target device; pass upload_port explicitly.",
          "TARGET_PORT_SELECTION_REQUIRED",
        );
      return candidates[0];
    },
  );
  return { environment: config.name, port };
}

/** Map the canonical tool spelling to the same executor used by the compatibility tool. */
export function executeRunTargetAction(
  input: unknown,
  client: SerialClientContext,
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const params = z
    .object({
      target: RunTargetSchema.shape.target,
      projectDir: z.string().min(1).max(32768),
      environment: RunTargetSchema.shape.env,
      uploadPort: RunTargetSchema.shape.upload_port,
      stopOpenSessions: z.boolean().default(false),
      approvalId: z.string().max(256).optional(),
      configApprovalId: z.string().max(256).optional(),
      selectionApprovalId: z.string().max(256).optional(),
    })
    .strict()
    .parse(input);
  return executeNamedTarget(
    {
      target: params.target,
      project_dir: params.projectDir,
      env: params.environment,
      upload_port: params.uploadPort,
      stop_open_sessions: params.stopOpenSessions,
      approval_id: params.approvalId,
      config_approval_id: params.configApprovalId,
      selection_approval_id: params.selectionApprovalId,
    },
    client,
    {},
    caller,
    onAuthorized,
  );
}

/** Preserve the original failure even when optional, separately authorized diagnosis is unavailable. */
export async function diagnoseTargetPortFailure(
  port: string | undefined,
  code: string,
  projectDir: string,
  caller: PolicyEvaluationContext,
) {
  const hints: Record<string, string> = {
    port_busy:
      "Close the serial connection holding the selected port, then retry.",
    port_permission: "Check OS access to the selected serial port, then retry.",
    port_missing: "Check the device connection and selected upload port.",
    no_response:
      "Check the board, boot mode and upload protocol before retrying.",
  };
  const base = {
    port: port ?? null,
    hint:
      hints[code] ?? "Inspect the retained command log and selected device.",
  };
  if (!port) return { ...base, diagnosis_status: "no_selected_port" };
  const args = { projectDir, port };
  const context = { ...caller, workspaceDir: projectDir };
  const permission = await planAction("list_devices", args, context);
  if (permission.status !== "ready")
    return { ...base, diagnosis_status: "not_authorized" };
  try {
    const observation = await dispatchAuthorizedAction(
      "list_devices",
      args,
      context,
      () => inspectPortDiagnostics(port, null),
    );
    return { ...base, ...observation, diagnosis_status: "observed" };
  } catch {
    return { ...base, diagnosis_status: "unavailable" };
  }
}
