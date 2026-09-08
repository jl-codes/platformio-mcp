/**
 * Unattended Automation Policy
 *
 * Provides:
 * - validateAutomationScope: Enforces project, environment, device, and run bounds.
 * - reserveAutomationWriteBudget: Atomically consumes a lab-runner write slot.
 */

import fs from "node:fs";
import path from "node:path";
import type { TargetBinding } from "../target-resolution.js";
import { PlatformIOError } from "../../utils/errors.js";
import { validateProjectPath } from "../../utils/validation.js";
import {
  readAutomationWriteBudgetState,
  validateAutomationKey,
  withAutomationStateLock,
  writeAutomationState,
} from "../automation-state.js";

const WRITE_ACTIONS = new Set([
  "upload_firmware",
  "upload_filesystem",
  "agent_flash_monitor_verify",
]);
const SAFE_SCHEDULED_ACTIONS = new Set([
  "list_devices",
  "list_boards",
  "get_board_info",
  "get_project_config",
  "get_project_context",
  "get_policy_status",
  "agent_resolve_target",
  "build_project",
  "check_project",
  "agent_build_diagnose",
  "check_task_status",
  "list_task_history",
  "get_monitor_status",
  "capture_serial_window",
  "agent_monitor_health",
  "query_logs",
  "cancel_task",
]);
const DEVICE_BOUND_ACTIONS = new Set(["capture_serial_window"]);
const ENVIRONMENT_SCOPED_ACTIONS = new Set([
  "build_project",
  "check_project",
  "agent_build_diagnose",
  ...DEVICE_BOUND_ACTIONS,
  ...WRITE_ACTIONS,
]);
const ALWAYS_DENIED_ACTIONS = new Set([
  "erase_flash",
  "reset_server_state",
  "run_shell_command",
  "ssh_deploy",
]);

/** Explicit repository-local policy required for unattended hardware writes. */
export interface LabRunnerAutomationPolicy {
  enabled: true;
  profile: "lab_runner";
  allowedOperations: string[];
  environment: string;
  deviceFingerprint: string;
  expiresAt: string;
  maxRunDurationSeconds: number;
  maxConsecutiveFlashes: number;
  cooldownSeconds: number;
}

/** Complete, normalized input used for automation policy evaluation. */
export interface AutomationScopeInput {
  automationKey: string;
  action: string;
  projectDir: string;
  environment?: string;
  targetBinding?: TargetBinding;
  maxRunDurationSeconds: number;
  consecutiveFlashes?: number;
  lastFlashAt?: string;
}

/**
 * Loads the opt-in lab-runner policy from the selected project.
 *
 * @param projectDir - Validated PlatformIO project directory.
 * @returns Parsed policy or undefined when not explicitly configured.
 */
function loadLabRunnerPolicy(
  projectDir: string,
): LabRunnerAutomationPolicy | undefined {
  const policyPath = path.join(
    projectDir,
    ".pio-mcp-workspace",
    "automation-policy.json",
  );
  if (!fs.existsSync(policyPath)) return undefined;
  try {
    return JSON.parse(
      fs.readFileSync(policyPath, "utf8"),
    ) as LabRunnerAutomationPolicy;
  } catch {
    throw new PlatformIOError(
      "The lab-runner automation policy is malformed.",
      "AUTOMATION_POLICY_DENIED",
    );
  }
}

/**
 * Enforces automation scope independently of conversational instructions.
 *
 * @param input - Scheduled action, exact target, and finite run constraints.
 * @returns Validated scope and whether the action changes hardware.
 */
export function validateAutomationScope(input: AutomationScopeInput): {
  allowed: true;
  writeOperation: boolean;
  policyProfile: string;
} {
  validateAutomationKey(input.automationKey);
  const projectDir = validateProjectPath(input.projectDir);
  if (projectDir === path.parse(projectDir).root) {
    throw new PlatformIOError(
      "Automation cannot target a filesystem root.",
      "AUTOMATION_POLICY_DENIED",
    );
  }
  if (input.environment?.includes("*")) {
    throw new PlatformIOError(
      "Automation target selectors must be exact and cannot contain wildcards.",
      "AUTOMATION_POLICY_DENIED",
    );
  }
  if (
    !Number.isFinite(input.maxRunDurationSeconds) ||
    input.maxRunDurationSeconds < 1 ||
    input.maxRunDurationSeconds > 900
  ) {
    throw new PlatformIOError(
      "Automation runs must have a maximum duration between 1 and 900 seconds.",
      "AUTOMATION_POLICY_DENIED",
    );
  }
  if (ALWAYS_DENIED_ACTIONS.has(input.action)) {
    throw new PlatformIOError(
      `Action '${input.action}' is never allowed in unattended automation.`,
      "AUTOMATION_POLICY_DENIED",
    );
  }

  const writeOperation = WRITE_ACTIONS.has(input.action);
  if (!writeOperation && !SAFE_SCHEDULED_ACTIONS.has(input.action)) {
    throw new PlatformIOError(
      `Action '${input.action}' is not available to unattended automation.`,
      "AUTOMATION_POLICY_DENIED",
    );
  }
  if (ENVIRONMENT_SCOPED_ACTIONS.has(input.action) && !input.environment) {
    throw new PlatformIOError(
      `Action '${input.action}' requires an exact PlatformIO environment.`,
      "AUTOMATION_POLICY_DENIED",
    );
  }
  if (
    (writeOperation || DEVICE_BOUND_ACTIONS.has(input.action)) &&
    !input.targetBinding
  ) {
    throw new PlatformIOError(
      `Action '${input.action}' requires a current physical target binding.`,
      "AUTOMATION_POLICY_DENIED",
    );
  }
  if (input.targetBinding) {
    if (
      input.targetBinding.port.includes("*") ||
      input.targetBinding.deviceFingerprint.includes("*")
    ) {
      throw new PlatformIOError(
        "Automation target selectors must be exact and cannot contain wildcards.",
        "AUTOMATION_POLICY_DENIED",
      );
    }
    if (
      path.resolve(input.targetBinding.projectDir) !== projectDir ||
      input.targetBinding.environment !== input.environment ||
      new Date(input.targetBinding.expiresAt).getTime() <= Date.now()
    ) {
      throw new PlatformIOError(
        "Automation target binding is expired or outside the requested scope.",
        "AUTOMATION_POLICY_DENIED",
      );
    }
  }
  if (!writeOperation) {
    return {
      allowed: true,
      writeOperation: false,
      policyProfile: "monitor_only",
    };
  }

  const policy = loadLabRunnerPolicy(projectDir);
  if (
    !policy?.enabled ||
    policy.profile !== "lab_runner" ||
    !policy.allowedOperations.includes(input.action) ||
    policy.environment !== input.environment ||
    policy.deviceFingerprint !== input.targetBinding!.deviceFingerprint ||
    new Date(policy.expiresAt).getTime() <= Date.now()
  ) {
    throw new PlatformIOError(
      "Unattended hardware writes require a current, exact lab-runner policy.",
      "AUTOMATION_POLICY_DENIED",
    );
  }
  if (input.maxRunDurationSeconds > policy.maxRunDurationSeconds) {
    throw new PlatformIOError(
      "Requested run duration exceeds the lab-runner policy.",
      "AUTOMATION_POLICY_DENIED",
    );
  }
  if ((input.consecutiveFlashes ?? 0) >= policy.maxConsecutiveFlashes) {
    throw new PlatformIOError(
      "The lab-runner consecutive flash limit has been reached.",
      "AUTOMATION_POLICY_DENIED",
    );
  }
  if (input.lastFlashAt) {
    const elapsedSeconds =
      (Date.now() - new Date(input.lastFlashAt).getTime()) / 1000;
    if (elapsedSeconds < policy.cooldownSeconds) {
      throw new PlatformIOError(
        "The lab-runner flash cooldown has not elapsed.",
        "AUTOMATION_POLICY_DENIED",
      );
    }
  }

  return { allowed: true, writeOperation: true, policyProfile: "lab_runner" };
}

/**
 * Atomically validates and records one unattended hardware-write attempt.
 *
 * Failed attempts deliberately consume a slot. A later healthy monitor result
 * resets the consecutive counter, preventing retry storms while still allowing
 * an operator-defined recovery loop.
 *
 * @param input - Exact scheduled write scope to reserve.
 * @returns Validated lab-runner scope and the persisted counter value.
 */
export async function reserveAutomationWriteBudget(
  input: AutomationScopeInput,
): Promise<{
  allowed: true;
  writeOperation: true;
  policyProfile: "lab_runner";
  consecutiveHardwareWrites: number;
}> {
  return withAutomationStateLock(
    input.projectDir,
    input.automationKey,
    async () => {
      const state = readAutomationWriteBudgetState(
        input.projectDir,
        input.automationKey,
      );
      const scope = validateAutomationScope({
        ...input,
        consecutiveFlashes: state.consecutiveHardwareWrites,
        lastFlashAt: state.lastHardwareWriteAt,
      });
      if (!scope.writeOperation) {
        throw new PlatformIOError(
          "Only hardware-changing automation actions consume a write budget.",
          "AUTOMATION_POLICY_DENIED",
        );
      }

      const consecutiveHardwareWrites = state.consecutiveHardwareWrites + 1;
      writeAutomationState(input.projectDir, {
        ...state,
        consecutiveHardwareWrites,
        lastHardwareWriteAt: new Date().toISOString(),
        lastHardwareWriteAction: input.action,
      });
      return {
        allowed: true,
        writeOperation: true,
        policyProfile: "lab_runner",
        consecutiveHardwareWrites,
      };
    },
  );
}
