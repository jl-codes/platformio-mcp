/**
 * Execute named PlatformIO targets with effect-based policy and caller-owned monitor cleanup.
 * Physical target adapters supply an already resolved serial port; discovery remains separately authorized.
 */
import { z } from "zod";
import { dispatchAuthorizedTarget } from "../core/target-effects.js";
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
  return dispatchAuthorizedTarget(
    request.target,
    {
      projectDir,
      environment: request.env ?? undefined,
      uploadPort: request.upload_port ?? undefined,
      stopOpenSessions: request.stop_open_sessions,
      approvalId: request.approval_id,
    },
    { ...caller, workspaceDir: projectDir },
    async (effects) => {
      const guard = createPolicyRevisionGuard(projectDir);
      await onAuthorized?.();
      guard();
      // A guessed/default port would not be the resource bound to this request's grant.
      if (effects.deviceAccess === "write" && !request.upload_port)
        throw new PlatformIOError(
          "Resolve an explicit upload port before executing a device target.",
          "TARGET_PORT_REQUIRED",
        );
      const endpoint = request.upload_port
        ? resolveSerialEndpoint(request.upload_port)
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
          await buildTarget(
            projectDir,
            request.target,
            request.env ?? undefined,
            false,
            {
              uploadPort: request.upload_port ?? undefined,
              serialPort: endpoint?.canonicalPort,
              timeoutMs: effects.deviceAccess === "write" ? 180000 : 1200000,
              onResult: async (result) => {
                completed = await collect(result.exitCode, result.fullLogPath);
              },
            },
          );
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
        return {
          ...cleanCompatibilityResult(
            completed,
            request.env ?? undefined,
            (performance.now() - started) / 1000,
            timedOut,
            "target-" + request.target,
          ),
          ...(effects.deviceAccess !== "none"
            ? { stopped_sessions: stopped }
            : {}),
        };
      });
    },
  );
}
