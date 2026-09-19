/**
 * Real policy-dispatcher integration for the owned serial session service.
 * Provides PolicySerialSessionService with request-local approvals and existing permission-source resolution.
 */
import fs from "node:fs";
import path from "node:path";
import {
  NativeSerialDiscovery,
  type NativeSerialDiscoveryOptions,
} from "../devices/native-serial-discovery.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { dispatchAuthorizedAction } from "../action-dispatcher.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import { PolicyConfigError } from "../policy/policy-schema.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import { PlatformIOError } from "../../utils/errors.js";
import {
  SerialSessionManager,
  type SerialSessionAuthorization,
  type SerialSessionDependencies,
} from "./session-manager.js";

/** Trusted adapter context; only a scoped approval ID may originate in validated public arguments. */
export interface SerialPolicyRequestContext {
  approvalId?: string;
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
  private readonly discovery: NativeSerialDiscovery;
  private readonly discoveryProject = new AsyncLocalStorage<string>();
  private readonly context = new AsyncLocalStorage<
    Readonly<SerialPolicyRequestContext>
  >();

  /** Optional dependency injection supplies leases/transports only, never an authorization override. */
  constructor(
    dependencies: Omit<SerialSessionDependencies, "authorize"> & {
      discoveryLoad?: NativeSerialDiscoveryOptions["load"];
    } = {},
  ) {
    this.discovery = new NativeSerialDiscovery({
      load: dependencies.discoveryLoad,
      authorize: () => this.authorizeDiscovery(),
    });
    this.sessions = new SerialSessionManager({
      ...dependencies,
      authorize: (request) => this.authorize(request),
    });
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
    for (const id of [context.approvalId, context.discoveryApprovalId]) {
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
    // Capture before asynchronous approval consumption, not after it: a changed policy cannot become the new baseline.
    let check: (() => void) | undefined;
    try {
      check = createPolicyRevisionGuard(request.projectDir);
    } catch (error) {
      if (!(error instanceof PolicyConfigError)) throw error;
      // Let the shared dispatcher report its normal invalid-policy denial below.
    }
    return dispatchAuthorizedAction(
      OPERATIONS[request.operation],
      { ...request, port: request.path, approvalId: context.approvalId },
      {
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
      },
      async () => {
        if (!check)
          throw new PlatformIOError(
            "Policy changed while authorizing serial operation.",
            "POLICY_CHANGED",
          );
        check();
        return check;
      },
    );
  }
}
