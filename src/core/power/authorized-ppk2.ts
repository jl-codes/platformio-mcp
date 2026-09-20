/** Authorize exact PPK2 meter/DUT bindings and electrical settings before supervised execution. */
import type { SerialPowerHold } from "../serial/session-manager.js";
import { dispatchAuthorizedAction, planAction } from "../action-dispatcher.js";
import { createPolicyRevisionGuard } from "../policy/revision-guard.js";
import type { PolicyEvaluationContext } from "../policy/types.js";
import { PlatformIOError } from "../../utils/errors.js";
import {
  PowerDeviceCustody,
  type PowerCustodyBinding,
} from "./power-device-custody.js";
import { Ppk2Process } from "./ppk2-process.js";
import { Ppk2RequestSchema } from "./ppk2-protocol.js";

/** Trusted host supplies discovery bindings and validated interpreter; tool callers supply neither capabilities nor executable paths. */
export interface AuthorizedPpk2Options {
  projectDir: string;
  pythonExecutable: string;
  request: unknown;
  meter: PowerCustodyBinding;
  dut: PowerCustodyBinding;
  guard?: () => void; // Retained outer request revision check; never supplied by public arguments.
  dutHold?: SerialPowerHold; // Internal capability issued by this connection's serial owner.
  hostApprovalId?: string;
  powerApprovalId?: string;
}

/** Retain before collect and until cleanup succeeds, including when authorization or startup throws. */
export class AuthorizedPpk2Operation {
  private readonly process: Ppk2Process;
  private readonly stages;
  private readonly context: PolicyEvaluationContext;
  private readonly guard: () => void;
  private readonly dutSignal?: AbortSignal;
  private used = false;
  private closing = false;

  /** Construct inert process/custody owners; grants are evaluated against a snapshot of exact execution inputs. */
  constructor(
    options: AuthorizedPpk2Options,
    caller: PolicyEvaluationContext = {},
  ) {
    const parsed = Ppk2RequestSchema.safeParse(options.request);
    if (!parsed.success)
      throw new PlatformIOError(
        "Invalid PPK2 request.",
        "PPK2_REQUEST_INVALID",
      );
    const request = parsed.data;
    this.context = {
      ...caller,
      workspaceDir: options.projectDir,
      devicePort: request.port,
    };
    const revision = createPolicyRevisionGuard(options.projectDir);
    const outerGuard = options.guard;
    this.guard = () => {
      revision();
      outerGuard?.();
    };
    this.dutSignal = options.dutHold?.signal;
    const custody = new PowerDeviceCustody(
      options.meter,
      options.dut,
      undefined,
      options.dutHold,
    );
    const resources = (binding: PowerCustodyBinding) =>
      binding.resources
        .map((resource) => ({ ...resource }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const scope = {
      projectDir: options.projectDir,
      pythonExecutable: options.pythonExecutable,
      request,
      meter: resources(options.meter),
      dut: resources(options.dut),
      durationSeconds: request.seconds,
      currentLimitKind: "software_trip",
      purpose: "ppk2_power_profile",
    };
    this.stages = [
      {
        action: "power_meter_command",
        args: { ...scope, approvalId: options.hostApprovalId },
      },
      {
        action:
          request.mode === "source" ? "power_source" : "power_meter_measure",
        args: { ...scope, approvalId: options.powerApprovalId },
      },
    ];
    this.process = new Ppk2Process({
      pythonExecutable: options.pythonExecutable,
      cwd: options.projectDir,
      request,
      custody: {
        prepareSpawn: async () => {
          this.guard();
          await custody.prepareSpawn();
          this.guard();
        },
        releaseAfterExit: () => custody.releaseAfterExit(),
      },
    });
  }

  /** Preflight both grants before consuming either; every policy revision ends collection and triggers owned cleanup. */
  async collect(signal?: AbortSignal) {
    if (this.dutSignal)
      signal = AbortSignal.any(
        signal ? [signal, this.dutSignal] : [this.dutSignal],
      );
    if (this.used || this.closing)
      throw new PlatformIOError(
        "Power operation owner is already used.",
        "PPK2_OWNER_CLOSED",
      );
    this.used = true;
    if (signal?.aborted)
      throw new PlatformIOError(
        "Power collection cancelled before authorization.",
        "PPK2_CANCELLED",
      );
    this.guard();
    for (const stage of this.stages) {
      const plan = await planAction(stage.action, stage.args, this.context);
      if (plan.status !== "ready")
        throw new PlatformIOError(
          plan.reason,
          plan.status === "requires_approval"
            ? "APPROVAL_REQUIRED"
            : "POLICY_DENIED",
          { policyDecision: plan },
        );
    }
    if (signal?.aborted)
      throw new PlatformIOError(
        "Power collection cancelled before execution.",
        "PPK2_CANCELLED",
      );
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    let revoked: unknown;
    const timer = setInterval(() => {
      try {
        this.guard();
      } catch (error) {
        revoked = error;
        abort.abort();
      }
    }, 100);
    try {
      return await dispatchAuthorizedAction(
        this.stages[0].action,
        this.stages[0].args,
        this.context,
        () =>
          dispatchAuthorizedAction(
            this.stages[1].action,
            this.stages[1].args,
            this.context,
            async () => {
              this.guard();
              const report = await this.process.collect(abort.signal);
              if (revoked) throw revoked;
              this.guard();
              return report;
            },
          ),
      );
    } finally {
      clearInterval(timer);
      signal?.removeEventListener("abort", cancel);
      await this.process.cleanupProcess();
    }
  }

  /** Preserve cleanup capability independently of authorization; shutdown never needs a new grant. */
  cleanupProcess(): Promise<void> {
    this.closing = true;
    return this.process.cleanupProcess();
  }

  /** Report uncertainty without interpreting software output-off acknowledgment as physical verification. */
  state() {
    return this.process.state();
  }
}
