/**
 * Real policy-dispatcher integration for the owned serial session service.
 * Provides PolicySerialSessionService with request-local approvals and existing permission-source resolution.
 */
import {
  captureSessionVerification,
  VerificationCaptureSchema,
  validateVerificationCapture,
} from "./verification-capture.js";
import {
  captureSessionPower,
  PowerCaptureSchema,
  validatePowerCapture,
} from "./power-capture.js";
import { captureSessionMemory, MemoryCaptureSchema } from "./memory-capture.js";
import { captureTransientMemory } from "./transient-memory-capture.js";
import { z } from "zod";
import { performance } from "node:perf_hooks";
import { bindSerialDiscovery } from "../devices/serial-discovery-binding.js";
import { SerialSessionBuffer } from "./session-buffer.js";
import { resolveSerialEndpoint } from "../devices/serial-endpoint.js";
import { validateDirectSerialOptions } from "./serial-transport.js";
import fs from "node:fs";
import path from "node:path";
import {
  NativeSerialDiscovery,
  type NativeSerialDiscoveryOptions,
} from "../devices/native-serial-discovery.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { dispatchAuthorizedAction, planAction } from "../action-dispatcher.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import { PolicyConfigError } from "../policy/policy-schema.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import { PlatformIOError } from "../../utils/errors.js";
import {
  SerialSessionManager,
  type SerialSessionAuthorization,
  type SerialSessionDependencies,
  type SerialSessionOwner,
  type SerialSessionRequest,
} from "./session-manager.js";

/** Trusted adapter context; only a scoped approval ID may originate in validated public arguments. */
export interface SerialPolicyRequestContext {
  approvalId?: string;
  readApprovalId?: string; // Separate read grant for composite open/read operations.
  discoveryApprovalId?: string; // Separate one-use list_devices grant.
  caller?: PolicyEvaluationContext;
}
const OPERATIONS = Object.freeze({
  start: "serial_session_start",
  read: "serial_session_read",
  write: "serial_session_write",
});

/** Bounded one-shot serial collection parameters, validated before opening any device. */
export const MonitorCaptureSchema = z
  .object({
    seconds: z.number().finite().default(5),
    until: z.string().max(4096).nullable().optional(),
    max_lines: z.number().int().min(1).max(10000).default(500),
  })
  .strict();

/**
 * Joins the service to existing operator/project policy, one-use approvals and policy revision checks.
 * No host config file is treated as an implicit hardware grant. Public adapters still own authentication.
 */
export class PolicySerialSessionService {
  readonly sessions: SerialSessionManager;
  private readonly transientMemoryScope = new AsyncLocalStorage<{
    input:
      | ReturnType<typeof MemoryCaptureSchema.parse>
      | ReturnType<typeof MonitorCaptureSchema.parse>
      | ReturnType<typeof VerificationCaptureSchema.parse>
      | ReturnType<typeof PowerCaptureSchema.parse>;
    purpose:
      | "one_shot_memory"
      | "one_shot_monitor"
      | "boot_verification"
      | "one_shot_power";
    readGuard?: () => void;
    expectedDeviceBinding?: string;
    expiresAt?: number;
    active: boolean;
    binding?: string;
    guard?: () => void;
  }>();

  /** Preauthorize meter opening/reading, then close only this operation's session on every outcome. */
  async capturePowerOnce(
    owner: SerialSessionOwner,
    request: Parameters<PolicySerialSessionService["startWithDiscovery"]>[1],
    input: z.input<typeof PowerCaptureSchema> = {},
    signal?: AbortSignal,
  ) {
    const args = await validatePowerCapture(input);
    if (signal?.aborted)
      throw new PlatformIOError(
        "Power collection cancelled before startup.",
        "SERIAL_CANCELLED",
      );
    const scope = {
      input: args,
      purpose: "one_shot_power" as const,
      active: true,
    };
    return this.transientMemoryScope.run(scope, async () => {
      try {
        const started = await this.startWithDiscovery(owner, request);
        let report: Awaited<ReturnType<typeof captureSessionPower>>;
        try {
          report = await this.capturePower(
            owner,
            started.sessionId,
            args,
            signal,
          );
        } catch (error) {
          const stopped = await this.sessions.stop(owner, started.sessionId);
          throw new PlatformIOError(
            error instanceof Error ? error.message : "Power capture failed.",
            error instanceof PlatformIOError
              ? error.code
              : "POWER_CAPTURE_FAILED",
            {
              ...(error instanceof PlatformIOError ? error.context : {}),
              sessionId: started.sessionId,
              cleanupPending: stopped.cleanupPending,
            },
          );
        }
        const stopped = await this.sessions.stop(owner, started.sessionId);
        return {
          ...report,
          ok: report.ok && !stopped.cleanupPending,
          collectionComplete:
            report.collectionComplete && !stopped.cleanupPending,
          cleanupPending: stopped.cleanupPending,
          state: stopped.state,
          port: started.path,
          baud: started.baudRate,
        };
      } finally {
        scope.active = false;
      }
    });
  }

  /** Plan opening and reading against stable device identity before opening a one-shot capture. */
  async captureMemoryOnce(
    owner: SerialSessionOwner,
    request: Parameters<PolicySerialSessionService["startWithDiscovery"]>[1],
    input: Parameters<typeof captureSessionMemory>[3] = {},
    signal?: AbortSignal,
  ) {
    const scope = {
      input: MemoryCaptureSchema.parse(input),
      purpose: "one_shot_memory" as const,
      active: true,
    };
    return this.transientMemoryScope.run(scope, async () => {
      try {
        return await captureTransientMemory(
          this,
          owner,
          request,
          scope.input,
          signal,
        );
      } finally {
        scope.active = false;
      }
    });
  }
  /** Plan opening and reading together, then close the owned port on every read outcome. */
  async captureMonitorOnce(
    owner: SerialSessionOwner,
    request: Parameters<PolicySerialSessionService["startWithDiscovery"]>[1],
    input: z.input<typeof MonitorCaptureSchema> = {},
  ) {
    const args = MonitorCaptureSchema.parse(input);
    const scope = {
      input: args,
      purpose: "one_shot_monitor" as const,
      active: true,
    };
    return this.transientMemoryScope.run(scope, async () => {
      try {
        const started = await this.startWithDiscovery(owner, request);
        let result: Awaited<ReturnType<SerialSessionManager["read"]>>;
        try {
          result = await this.sessions.read(owner, started.sessionId, {
            cursor: 0,
            maxLines: args.max_lines,
            timeoutMs: Math.round(
              Math.max(0, Math.min(args.seconds, 120)) * 1000,
            ),
            waitFor: args.until || undefined,
            patternOptions: { mode: "regex", pythonNamedGroups: true },
            referenceSemantics: true,
          });
        } catch (error) {
          const stopped = await this.sessions.stop(owner, started.sessionId);
          throw new PlatformIOError(
            error instanceof PlatformIOError
              ? error.message
              : "Monitor capture failed.",
            error instanceof PlatformIOError
              ? error.code
              : "SERIAL_CAPTURE_FAILED",
            {
              ...(error instanceof PlatformIOError ? error.context : {}),
              sessionId: started.sessionId,
              cleanupPending: stopped.cleanupPending,
            },
          );
        }
        const stopped = await this.sessions.stop(owner, started.sessionId);
        return { result, session: stopped };
      } finally {
        scope.active = false;
      }
    });
  }
  /** Resolve and plan boot opening/reading before upload, without consuming either hardware grant or opening a port. */
  async preflightVerificationCapture(
    owner: SerialSessionOwner,
    input: Parameters<PolicySerialSessionService["startWithDiscovery"]>[1],
    options: z.input<typeof VerificationCaptureSchema> = {},
    startupDiscoveryApprovalId?: string,
  ) {
    const checkOwner = this.sessions.createStartupGuard(owner);
    validateDirectSerialOptions(input);
    // Use the same storage validation/defaults as actual startup before any discovery.
    new SerialSessionBuffer(input.buffer);
    const args = await validateVerificationCapture(options);
    if (!path.isAbsolute(input.projectDir))
      throw new PlatformIOError(
        "Serial project must be absolute.",
        "SERIAL_PROJECT_INVALID",
      );
    const projectDir = fs.realpathSync.native(input.projectDir);
    const guard = createPolicyRevisionGuard(projectDir);
    const discoveryPlan = await planAction(
      "serial_startup_discovery",
      {
        ...input,
        projectDir,
        buffer: input.buffer ? { ...input.buffer } : undefined,
        snapshots: 4,
        approvalId: startupDiscoveryApprovalId,
      },
      { ...this.context.getStore()?.caller, workspaceDir: projectDir },
    );
    if (discoveryPlan.status !== "ready")
      throw new PlatformIOError(
        discoveryPlan.reason,
        discoveryPlan.status === "deny" ? "POLICY_DENIED" : "APPROVAL_REQUIRED",
        { policyDecision: discoveryPlan },
      );
    guard();
    const endpoint = this.resolveEndpoint(input.path);
    const binding = bindSerialDiscovery(
      endpoint,
      await this.listSerialDevices(projectDir),
      this.resolveEndpoint,
    );
    checkOwner();
    guard();
    const request: SerialSessionAuthorization = {
      operation: "start",
      projectDir,
      path: endpoint.canonicalPort,
      baudRate: input.baudRate,
      operationTimeoutMs: input.operationTimeoutMs ?? 5000,
      resource: endpoint.resource,
      ...(binding.usbIdentity
        ? {
            additionalResources: [
              { kind: "serial" as const, identity: binding.usbIdentity },
            ],
          }
        : {}),
      bufferLimits: {
        maxLines: input.buffer?.maxLines ?? 5000,
        maxBytes: input.buffer?.maxBytes ?? 1048576,
        maxLineBytes:
          input.buffer?.maxLineBytes ??
          Math.min(16384, input.buffer?.maxBytes ?? 1048576),
      },
    };
    const scope = {
      input: args,
      purpose: "boot_verification" as const,
      active: true,
    };
    try {
      await this.transientMemoryScope.run(scope, () =>
        this.authorize(request, true),
      );
      checkOwner();
      guard();
      return {
        port: endpoint.canonicalPort,
        identityBasis: binding.identityBasis,
        deviceBinding: verificationDeviceBinding(request),
      };
    } finally {
      scope.active = false;
    }
  }
  /** Open a fresh boot capture, bind all pages to one bounded read grant, and always close its owned port. */
  async captureVerificationOnce(
    owner: SerialSessionOwner,
    request: Parameters<PolicySerialSessionService["startWithDiscovery"]>[1],
    input: z.input<typeof VerificationCaptureSchema> = {},
    signal?: AbortSignal,
    expectedDeviceBinding?: string,
  ) {
    const args = await validateVerificationCapture(input);
    const scope = {
      expectedDeviceBinding,
      input: args,
      purpose: "boot_verification" as const,
      active: true,
      expiresAt:
        performance.now() +
        (args.timeoutSeconds + args.settleSeconds + 30) * 1000,
    };
    return this.transientMemoryScope.run(scope, async () => {
      try {
        const started = await this.startWithDiscovery(owner, request);
        let report: Awaited<ReturnType<typeof captureSessionVerification>>;
        try {
          report = await captureSessionVerification(
            this.sessions,
            owner,
            started.sessionId,
            args,
            signal,
          );
        } catch (error) {
          const stopped = await this.sessions.stop(owner, started.sessionId);
          throw new PlatformIOError(
            error instanceof PlatformIOError
              ? error.message
              : "Boot verification failed.",
            error instanceof PlatformIOError
              ? error.code
              : "VERIFICATION_CAPTURE_FAILED",
            {
              ...(error instanceof PlatformIOError ? error.context : {}),
              sessionId: started.sessionId,
              cleanupPending: stopped.cleanupPending,
            },
          );
        }
        const stopped = await this.sessions.stop(owner, started.sessionId);
        return {
          ...report,
          ok: report.ok && !stopped.cleanupPending,
          verdict:
            stopped.cleanupPending && report.verdict === "pass"
              ? ("inconclusive" as const)
              : report.verdict,
          cleanupPending: stopped.cleanupPending,
          sessionId: started.sessionId,
          port: started.path,
          baud: started.baudRate,
        };
      } finally {
        scope.active = false;
      }
    });
  }
  private readonly memoryReadScope = new AsyncLocalStorage<{
    sessionId: string;
    input:
      | ReturnType<typeof MemoryCaptureSchema.parse>
      | ReturnType<typeof PowerCaptureSchema.parse>;
    kind?: "power";
    active: boolean;
    expiresAt: number;
    guard?: () => void;
  }>();

  /** Consume one scoped meter-read grant and retain policy revision checks through final disclosure. */
  async capturePower(
    owner: SerialSessionOwner,
    sessionId: string,
    input: z.input<typeof PowerCaptureSchema> = {},
    signal?: AbortSignal,
  ) {
    const args = PowerCaptureSchema.parse(input);
    const scope = {
      sessionId,
      input: args,
      kind: "power" as const,
      active: true,
      expiresAt: performance.now() + args.seconds * 1000 + 30000,
    };
    return this.memoryReadScope.run(scope, async () => {
      try {
        return await captureSessionPower(
          this.sessions,
          owner,
          sessionId,
          args,
          signal,
        );
      } finally {
        scope.active = false;
      }
    });
  }

  /** Authorize one bounded capture, retaining revision checks on every page and final disclosure. */
  async captureMemory(
    owner: SerialSessionOwner,
    sessionId: string,
    input: Parameters<typeof captureSessionMemory>[3] = {},
    signal?: AbortSignal,
  ) {
    const args = MemoryCaptureSchema.parse(input);
    const scope = {
      sessionId,
      input: args,
      active: true,
      expiresAt: performance.now() + 315000,
    };
    return this.memoryReadScope.run(scope, async () => {
      try {
        return await captureSessionMemory(
          this.sessions,
          owner,
          sessionId,
          args,
          signal,
        );
      } finally {
        scope.active = false;
      }
    });
  }
  private readonly discovery: NativeSerialDiscovery;
  private readonly discoveryBatch = new AsyncLocalStorage<{
    projectDir: string;
    remaining: number;
    active: boolean;
    expiresAt: number;
    guard: () => void;
  }>();
  private readonly resolveEndpoint: typeof resolveSerialEndpoint;
  private readonly discoveryProject = new AsyncLocalStorage<string>();
  private readonly context = new AsyncLocalStorage<
    Readonly<SerialPolicyRequestContext>
  >();

  /** Optional dependency injection supplies leases/transports only, never an authorization override. */
  constructor(
    dependencies: Omit<SerialSessionDependencies, "authorize"> & {
      discoveryLoad?: NativeSerialDiscoveryOptions["load"];
      resolveEndpoint?: typeof resolveSerialEndpoint;
    } = {},
  ) {
    this.resolveEndpoint =
      dependencies.resolveEndpoint ?? resolveSerialEndpoint;
    this.discovery = new NativeSerialDiscovery({
      load: dependencies.discoveryLoad,
      authorize: () => this.authorizeDiscovery(),
    });
    this.sessions = new SerialSessionManager({
      ...dependencies,
      authorize: (request) => this.authorize(request),
    });
  }

  /** Authorize four identity snapshots for one startup; opening retains its separate permission check. */
  async startWithDiscovery(
    owner: SerialSessionOwner,
    input: Omit<
      SerialSessionRequest,
      "resource" | "additionalResources" | "revalidateEndpoint"
    >,
  ) {
    const checkOwner = this.sessions.createStartupGuard(owner);
    validateDirectSerialOptions(input);
    if (!path.isAbsolute(input.projectDir))
      throw new PlatformIOError(
        "Serial project must be absolute.",
        "SERIAL_PROJECT_INVALID",
      );
    const request = Object.freeze({
      ...input,
      projectDir: fs.realpathSync.native(input.projectDir),
      buffer: input.buffer ? Object.freeze({ ...input.buffer }) : undefined,
    });
    const context = this.context.getStore();
    if (!context)
      throw new PlatformIOError(
        "Trusted request context required.",
        "SERIAL_AUTHORIZATION_CONTEXT_REQUIRED",
      );
    const guard = createPolicyRevisionGuard(request.projectDir);
    return dispatchAuthorizedAction(
      "serial_startup_discovery",
      { ...request, snapshots: 4, approvalId: context.discoveryApprovalId },
      { ...context.caller, workspaceDir: request.projectDir },
      async () => {
        checkOwner();
        guard();
        const batch = {
          projectDir: request.projectDir,
          remaining: 4,
          active: true,
          expiresAt: performance.now() + 30000,
          guard,
        };
        try {
          return await this.discoveryBatch.run(batch, () =>
            this.sessions.startDiscovered(owner, request, {
              list: () => this.listSerialDevices(request.projectDir),
              resolve: this.resolveEndpoint,
            }),
          );
        } finally {
          batch.active = false;
        }
      },
    );
  }

  /** Enumerate through one shared native provider under this request's canonical workspace policy. */
  async listSerialDevices(projectDir: string) {
    if (!path.isAbsolute(projectDir))
      throw new PlatformIOError(
        "Serial project directory must be absolute.",
        "SERIAL_PROJECT_INVALID",
      );
    const canonical = fs.realpathSync.native(projectDir);
    if (!fs.statSync(canonical).isDirectory())
      throw new PlatformIOError(
        "Serial project directory is not a directory.",
        "SERIAL_PROJECT_INVALID",
      );
    return this.discoveryProject.run(canonical, () => this.discovery.list());
  }

  /** Return only this caller's session metadata for one authorized canonical project. */
  async listSessions(owner: SerialSessionOwner, projectDir: string) {
    // Validate the unforgeable owner before consuming an approval or exposing metadata.
    this.sessions.list(owner);
    const context = this.context.getStore();
    if (!context)
      throw new PlatformIOError(
        "Session listing requires a trusted request context.",
        "SERIAL_AUTHORIZATION_CONTEXT_REQUIRED",
      );
    if (!path.isAbsolute(projectDir))
      throw new PlatformIOError(
        "Serial project must be absolute.",
        "SERIAL_PROJECT_INVALID",
      );
    const canonical = fs.realpathSync.native(projectDir);
    if (!fs.statSync(canonical).isDirectory())
      throw new PlatformIOError(
        "Serial project must be a directory.",
        "SERIAL_PROJECT_INVALID",
      );
    let check: (() => void) | undefined;
    try {
      check = createPolicyRevisionGuard(canonical);
    } catch (error) {
      if (!(error instanceof PolicyConfigError)) throw error;
    }
    return dispatchAuthorizedAction(
      "serial_session_list",
      { projectDir: canonical, approvalId: context.approvalId },
      { ...context.caller, workspaceDir: canonical },
      async () => {
        if (!check)
          throw new PlatformIOError(
            "Policy changed during session listing.",
            "POLICY_CHANGED",
          );
        check();
        const sessions = this.sessions
          .list(owner)
          .filter((session) => session.projectDir === canonical);
        check();
        return sessions;
      },
    );
  }

  /** Use the existing inspection action; a serial-open approval is never reused as an enumeration grant. */
  private async authorizeDiscovery(): Promise<() => void> {
    const context = this.context.getStore();
    const projectDir = this.discoveryProject.getStore();
    if (!context || !projectDir)
      throw new PlatformIOError(
        "Serial discovery requires a trusted request context.",
        "SERIAL_AUTHORIZATION_CONTEXT_REQUIRED",
      );
    const batch = this.discoveryBatch.getStore();
    if (batch) {
      const guard = () => {
        if (
          !batch.active ||
          batch.projectDir !== projectDir ||
          performance.now() > batch.expiresAt
        )
          throw new PlatformIOError(
            "Startup discovery scope expired.",
            "SERIAL_DISCOVERY_SCOPE_INVALID",
          );
        batch.guard();
      };
      guard();
      if (batch.remaining-- <= 0)
        throw new PlatformIOError(
          "Startup discovery limit exceeded.",
          "SERIAL_DISCOVERY_SCOPE_INVALID",
        );
      return guard;
    }
    let check: (() => void) | undefined;
    try {
      check = createPolicyRevisionGuard(projectDir);
    } catch (error) {
      if (!(error instanceof PolicyConfigError)) throw error;
    }
    return dispatchAuthorizedAction(
      "list_devices",
      { projectDir, approvalId: context.discoveryApprovalId },
      { ...context.caller, workspaceDir: projectDir },
      async () => {
        if (!check)
          throw new PlatformIOError(
            "Policy changed during discovery authorization.",
            "POLICY_CHANGED",
          );
        check();
        return check;
      },
    );
  }

  /** Keep approval/caller context isolated across overlapping client requests. */
  run<T>(
    context: SerialPolicyRequestContext,
    execute: () => Promise<T>,
  ): Promise<T> {
    for (const id of [
      context.approvalId,
      context.readApprovalId,
      context.discoveryApprovalId,
    ]) {
      if (
        id !== undefined &&
        (typeof id !== "string" || !id || id.length > 256)
      )
        throw new PlatformIOError(
          "Invalid serial approval identifier.",
          "APPROVAL_SCOPE_INVALID",
        );
    }
    return this.context.run(
      Object.freeze({
        approvalId: context.approvalId,
        readApprovalId: context.readApprovalId,
        discoveryApprovalId: context.discoveryApprovalId,
        caller: Object.freeze({ ...context.caller }),
      }),
      execute,
    );
  }

  private async authorize(
    request: Readonly<SerialSessionAuthorization>,
    planOnly = false,
  ): Promise<() => void> {
    const context = this.context.getStore();
    if (!context)
      throw new PlatformIOError(
        "Serial operations require a trusted request context.",
        "SERIAL_AUTHORIZATION_CONTEXT_REQUIRED",
      );
    const scope = this.memoryReadScope.getStore();
    const scopedRead =
      scope &&
      request.operation === "read" &&
      request.sessionId === scope.sessionId;
    const checkScope = () => {
      if (scopedRead && (!scope.active || performance.now() > scope.expiresAt))
        throw new PlatformIOError(
          "Memory capture authorization scope expired.",
          "SERIAL_CAPTURE_SCOPE_INVALID",
        );
    };
    checkScope();
    if (scopedRead && scope.guard) {
      scope.guard();
      return scope.guard;
    }
    // Capture before asynchronous approval consumption, not after it: a changed policy cannot become the new baseline.
    let check: (() => void) | undefined;
    try {
      check = createPolicyRevisionGuard(request.projectDir);
    } catch (error) {
      if (!(error instanceof PolicyConfigError)) throw error;
      // Let the shared dispatcher report its normal invalid-policy denial below.
    }
    const transient = this.transientMemoryScope.getStore();
    if (
      transient &&
      (!transient.active ||
        (transient.expiresAt !== undefined &&
          performance.now() > transient.expiresAt))
    )
      throw new PlatformIOError(
        "Transient memory scope expired.",
        "SERIAL_CAPTURE_SCOPE_INVALID",
      );
    transient?.guard?.();
    const deviceRequest = Object.fromEntries(
      Object.entries(request).filter(
        ([key]) => key !== "sessionId" && key !== "operation",
      ),
    );
    const binding = JSON.stringify(deviceRequest);
    if (
      transient?.expectedDeviceBinding &&
      verificationDeviceBinding(request) !== transient.expectedDeviceBinding
    )
      throw new PlatformIOError(
        "The verification device changed after preflight.",
        "SERIAL_DEVICE_CHANGED",
      );

    if (
      transient &&
      request.operation === "read" &&
      transient.binding !== binding
    )
      throw new PlatformIOError(
        "Transient memory device identity changed.",
        "SERIAL_CAPTURE_SCOPE_INVALID",
      );
    if (
      transient?.purpose === "boot_verification" &&
      request.operation === "read" &&
      transient.readGuard
    ) {
      transient.readGuard();
      return transient.readGuard;
    }
    const authorizationArgs: Record<string, unknown> = {
      ...request,
      port: request.path,
      approvalId:
        request.operation === "read"
          ? (context.readApprovalId ?? context.approvalId)
          : context.approvalId,
      ...(scopedRead
        ? {
            [scope.kind === "power" ? "powerCapture" : "memoryCapture"]:
              scope.input,
          }
        : {}),
    };
    if (transient) {
      delete authorizationArgs.sessionId;
      authorizationArgs[
        transient.purpose === "one_shot_power"
          ? "powerCapture"
          : transient.purpose === "one_shot_memory"
            ? "memoryCapture"
            : transient.purpose === "boot_verification"
              ? "bootVerification"
              : "monitorCapture"
      ] = transient.input;
      authorizationArgs.purpose = transient.purpose;
    }
    const caller = {
      ...context.caller,
      workspaceDir: request.projectDir,
      devicePort: request.path,
      targetBindingDigest: createHash("sha256")
        .update(
          JSON.stringify([
            [request.resource.kind, request.resource.identity],
            ...(request.additionalResources ?? []).map((resource) => [
              resource.kind,
              resource.identity,
            ]),
          ]),
        )
        .digest("hex"),
    };
    if (transient && request.operation === "start") {
      const opening = await planAction(
        OPERATIONS.start,
        authorizationArgs,
        caller,
      );
      const reading = await planAction(
        OPERATIONS.read,
        {
          ...authorizationArgs,
          operation: "read",
          approvalId: context.readApprovalId,
        },
        caller,
      );
      const decisions = { opening, reading };
      if (opening.status !== "ready" || reading.status !== "ready")
        throw new PlatformIOError(
          "One-shot capture needs opening and reading permissions before startup.",
          opening.status === "deny" || reading.status === "deny"
            ? "POLICY_DENIED"
            : "APPROVAL_REQUIRED",
          { decisions },
        );
      transient.binding = binding;
    }
    if (planOnly) {
      if (
        transient?.purpose !== "boot_verification" ||
        request.operation !== "start" ||
        !check
      )
        throw new PlatformIOError(
          "Invalid verification preflight context.",
          "SERIAL_CAPTURE_SCOPE_INVALID",
        );
      check();
      return check;
    }
    return dispatchAuthorizedAction(
      OPERATIONS[request.operation],
      authorizationArgs,
      caller,
      async () => {
        if (!check)
          throw new PlatformIOError(
            "Policy changed while authorizing serial operation.",
            "POLICY_CHANGED",
          );
        check();
        if (transient && request.operation === "start") transient.guard = check;
        if (
          transient?.purpose === "boot_verification" &&
          request.operation === "read"
        ) {
          const revision = check;
          const guard = () => {
            if (!transient.active || performance.now() > transient.expiresAt!)
              throw new PlatformIOError(
                "Boot verification scope expired.",
                "SERIAL_CAPTURE_SCOPE_INVALID",
              );
            revision();
          };
          transient.readGuard = guard;
          return guard;
        }
        if (scopedRead) {
          const revision = check;
          const guard = () => {
            checkScope();
            revision();
          };
          scope.guard = guard;
          return guard;
        }
        return check;
      },
    );
  }
}

/** Stable internal request identity independent of object insertion order or generated session IDs. */
function verificationDeviceBinding(
  request: Readonly<SerialSessionAuthorization>,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        request.projectDir,
        request.path,
        request.baudRate,
        request.operationTimeoutMs,
        request.resource.kind,
        request.resource.identity,
        (request.additionalResources ?? []).map((resource) => [
          resource.kind,
          resource.identity,
        ]),
        request.bufferLimits.maxLines,
        request.bufferLimits.maxBytes,
        request.bufferLimits.maxLineBytes,
      ]),
    )
    .digest("hex");
}
