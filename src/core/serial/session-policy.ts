/**
 * Real policy-dispatcher integration for the owned serial session service.
 * Provides PolicySerialSessionService with request-local approvals and existing permission-source resolution.
 */
import { captureSessionMemory, MemoryCaptureSchema } from "./memory-capture.js";
import { captureTransientMemory } from "./transient-memory-capture.js";
import { performance } from "node:perf_hooks";
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

/**
 * Joins the service to existing operator/project policy, one-use approvals and policy revision checks.
 * No host config file is treated as an implicit hardware grant. Public adapters still own authentication.
 */
export class PolicySerialSessionService {
  readonly sessions: SerialSessionManager;
  private readonly transientMemoryScope = new AsyncLocalStorage<{
    input: ReturnType<typeof MemoryCaptureSchema.parse>;
    active: boolean;
    binding?: string;
    guard?: () => void;
  }>();

  /** Plan opening and reading against stable device identity before opening a one-shot capture. */
  async captureMemoryOnce(
    owner: SerialSessionOwner,
    request: Parameters<PolicySerialSessionService["startWithDiscovery"]>[1],
    input: Parameters<typeof captureSessionMemory>[3] = {},
    signal?: AbortSignal,
  ) {
    const scope = { input: MemoryCaptureSchema.parse(input), active: true };
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
  private readonly memoryReadScope = new AsyncLocalStorage<{
    sessionId: string;
    input: ReturnType<typeof MemoryCaptureSchema.parse>;
    active: boolean;
    expiresAt: number;
    guard?: () => void;
  }>();

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
    if (transient && !transient.active)
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
      transient &&
      request.operation === "read" &&
      transient.binding !== binding
    )
      throw new PlatformIOError(
        "Transient memory device identity changed.",
        "SERIAL_CAPTURE_SCOPE_INVALID",
      );
    const authorizationArgs: Record<string, unknown> = {
      ...request,
      port: request.path,
      approvalId:
        request.operation === "read"
          ? (context.readApprovalId ?? context.approvalId)
          : context.approvalId,
      ...(scopedRead ? { memoryCapture: scope.input } : {}),
    };
    if (transient) {
      delete authorizationArgs.sessionId;
      authorizationArgs.memoryCapture = transient.input;
      authorizationArgs.purpose = "one_shot_memory";
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
          "One-shot memory capture needs opening and reading permissions before startup.",
          opening.status === "deny" || reading.status === "deny"
            ? "POLICY_DENIED"
            : "APPROVAL_REQUIRED",
          { decisions },
        );
      transient.binding = binding;
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
