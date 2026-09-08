/**
 * Monitoring Automation State
 *
 * Provides:
 * - readAutomationState: Reads bounded change-detection state.
 * - writeAutomationState: Atomically persists state without log evidence.
 * - withAutomationStateLock: Prevents overlapping runs for one automation key.
 * - listAutomationStates: Returns dashboard-safe state summaries.
 * - clearAutomationMonitorState: Clears stale monitor data without resetting write budgets.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import type { TargetBinding } from "./target-resolution.js";
import { PlatformIOError } from "../utils/errors.js";
import { validateProjectPath } from "../utils/validation.js";
import { portalEvents } from "../api/events.js";

const MAX_STATE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Persisted state used to make scheduled monitoring change-aware. */
export interface AutomationState {
  schemaVersion: 1;
  automationKey: string;
  cursor?: string;
  digest?: string;
  lastStatus?: string;
  consecutiveFailures: number;
  consecutiveHardwareWrites: number;
  lastHardwareWriteAt?: string;
  lastHardwareWriteAction?: string;
  targetBinding?: TargetBinding;
  createdAt: string;
  updatedAt: string;
}

/** Dashboard-safe automation state without serial evidence or local paths. */
export interface AutomationStateSummary {
  automationKey: string;
  state: "healthy" | "stale" | "binding_expired" | "invalid";
  lastStatus?: string;
  consecutiveFailures: number;
  consecutiveHardwareWrites: number;
  lastHardwareWriteAt?: string;
  lastHardwareWriteAction?: string;
  environment?: string;
  bindingExpiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Validates an automation key before using it as a filename.
 *
 * @param automationKey - User-selected stable automation identifier.
 * @returns Validated key.
 */
export function validateAutomationKey(automationKey: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u.test(automationKey)) {
    throw new PlatformIOError(
      "automationKey must be 1-80 letters, numbers, underscores, or hyphens.",
      "AUTOMATION_POLICY_DENIED",
    );
  }
  return automationKey;
}

/**
 * Resolves the private workspace state path for an automation.
 *
 * @param projectDir - PlatformIO project directory.
 * @param automationKey - Validated automation key.
 * @returns Absolute JSON state path.
 */
export function getAutomationStatePath(
  projectDir: string,
  automationKey: string,
): string {
  const projectRoot = validateProjectPath(projectDir);
  const key = validateAutomationKey(automationKey);
  return path.join(
    projectRoot,
    ".pio-mcp-workspace",
    "automations",
    `${key}.json`,
  );
}

/**
 * Creates initial empty state for a new automation.
 *
 * @param automationKey - Validated automation key.
 * @param now - Optional deterministic timestamp.
 * @returns Fresh state record.
 */
function createEmptyState(
  automationKey: string,
  now = new Date(),
): AutomationState {
  const timestamp = now.toISOString();
  return {
    schemaVersion: 1,
    automationKey,
    consecutiveFailures: 0,
    consecutiveHardwareWrites: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Parses persisted state with optional stale-record tolerance.
 *
 * @param projectDir - PlatformIO project directory.
 * @param automationKey - Stable automation identifier.
 * @param allowStale - Whether a structurally valid old record may be returned.
 * @returns Parsed state, or a new state when no record exists.
 */
function readAutomationStateRecord(
  projectDir: string,
  automationKey: string,
  allowStale: boolean,
): AutomationState {
  const statePath = getAutomationStatePath(projectDir, automationKey);
  if (!fs.existsSync(statePath)) return createEmptyState(automationKey);

  let state: AutomationState;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8")) as AutomationState;
  } catch {
    throw new PlatformIOError(
      `Automation '${automationKey}' state is malformed and requires operator review.`,
      "AUTOMATION_POLICY_DENIED",
    );
  }
  const updatedAt = new Date(state.updatedAt).getTime();
  if (
    state.schemaVersion !== 1 ||
    state.automationKey !== automationKey ||
    !Number.isFinite(updatedAt) ||
    !Number.isInteger(state.consecutiveFailures) ||
    state.consecutiveFailures < 0 ||
    !Number.isInteger(state.consecutiveHardwareWrites) ||
    state.consecutiveHardwareWrites < 0
  ) {
    throw new PlatformIOError(
      `Automation '${automationKey}' state cannot be verified and requires operator review.`,
      "AUTOMATION_POLICY_DENIED",
    );
  }
  if (!allowStale && Date.now() - updatedAt > MAX_STATE_AGE_MS) {
    throw new PlatformIOError(
      `Automation '${automationKey}' write budget is stale and requires operator review.`,
      "AUTOMATION_POLICY_DENIED",
    );
  }
  return state;
}

/**
 * Reads current state, recovering safely from stale or malformed content.
 *
 * @param projectDir - PlatformIO project directory.
 * @param automationKey - Stable automation identifier.
 * @returns Existing or reset state.
 */
export function readAutomationState(
  projectDir: string,
  automationKey: string,
): AutomationState {
  try {
    return readAutomationStateRecord(projectDir, automationKey, false);
  } catch {
    return createEmptyState(automationKey);
  }
}

/**
 * Reads a write budget without silently recovering from stale or malformed state.
 *
 * @param projectDir - PlatformIO project directory.
 * @param automationKey - Stable automation identifier.
 * @returns Verified state for a hardware-write policy decision.
 */
export function readAutomationWriteBudgetState(
  projectDir: string,
  automationKey: string,
): AutomationState {
  return readAutomationStateRecord(projectDir, automationKey, false);
}

/**
 * Persists monitoring state using an atomic same-directory rename.
 *
 * @param projectDir - PlatformIO project directory.
 * @param state - Complete state record without serial evidence.
 * @returns Persisted state with a fresh timestamp.
 */
export function writeAutomationState(
  projectDir: string,
  state: AutomationState,
): AutomationState {
  const statePath = getAutomationStatePath(projectDir, state.automationKey);
  const directory = path.dirname(statePath);
  fs.mkdirSync(directory, { recursive: true });
  const nextState: AutomationState = {
    ...state,
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
  };
  const temporaryPath = path.join(
    directory,
    `.${state.automationKey}.${crypto.randomUUID()}.tmp`,
  );
  fs.writeFileSync(temporaryPath, `${JSON.stringify(nextState, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, statePath);
  portalEvents.emitSafetyStateUpdated(projectDir);
  return nextState;
}

/**
 * Lists bounded automation summaries for the authenticated dashboard.
 * Malformed state is reported as invalid without returning its contents.
 *
 * @param projectDir - PlatformIO project directory.
 * @returns Newest-first state summaries.
 */
export function listAutomationStates(
  projectDir: string,
): AutomationStateSummary[] {
  const projectRoot = validateProjectPath(projectDir);
  const directory = path.join(projectRoot, ".pio-mcp-workspace", "automations");
  if (!fs.existsSync(directory)) return [];

  const now = Date.now();
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .slice(0, 100)
    .map((entry): AutomationStateSummary => {
      const automationKey = entry.name.slice(0, -".json".length);
      try {
        validateAutomationKey(automationKey);
        const state = JSON.parse(
          fs.readFileSync(path.join(directory, entry.name), "utf8"),
        ) as AutomationState;
        const updatedAt = new Date(state.updatedAt).getTime();
        if (
          state.schemaVersion !== 1 ||
          state.automationKey !== automationKey ||
          !Number.isFinite(updatedAt)
        ) {
          throw new Error("Invalid automation state");
        }
        const bindingExpiresAt = state.targetBinding?.expiresAt;
        const bindingExpired =
          bindingExpiresAt !== undefined &&
          new Date(bindingExpiresAt).getTime() <= now;
        return {
          automationKey,
          state:
            now - updatedAt > MAX_STATE_AGE_MS
              ? "stale"
              : bindingExpired
                ? "binding_expired"
                : "healthy",
          lastStatus: state.lastStatus,
          consecutiveFailures: Number.isInteger(state.consecutiveFailures)
            ? Math.max(0, state.consecutiveFailures)
            : 0,
          consecutiveHardwareWrites: Number.isInteger(
            state.consecutiveHardwareWrites,
          )
            ? Math.max(0, state.consecutiveHardwareWrites)
            : 0,
          lastHardwareWriteAt: state.lastHardwareWriteAt,
          lastHardwareWriteAction: state.lastHardwareWriteAction,
          environment: state.targetBinding?.environment,
          bindingExpiresAt,
          createdAt: state.createdAt,
          updatedAt: state.updatedAt,
        };
      } catch {
        return {
          automationKey,
          state: "invalid",
          consecutiveFailures: 0,
          consecutiveHardwareWrites: 0,
        };
      }
    })
    .sort(
      (left, right) =>
        new Date(right.updatedAt ?? 0).getTime() -
        new Date(left.updatedAt ?? 0).getTime(),
    );
}

/**
 * Clears change-detection state while preserving the hardware-write budget.
 * This prevents a dashboard reset from bypassing lab-runner flash limits.
 *
 * @param projectDir - PlatformIO project directory.
 * @param automationKey - Stable automation identifier.
 * @returns Fresh monitoring state with any write budget retained.
 */
export async function clearAutomationMonitorState(
  projectDir: string,
  automationKey: string,
): Promise<AutomationState> {
  return withAutomationStateLock(projectDir, automationKey, async () => {
    const previous = readAutomationStateRecord(
      projectDir,
      automationKey,
      true,
    );
    const reset = createEmptyState(automationKey);
    return writeAutomationState(projectDir, {
      ...reset,
      createdAt: previous.createdAt,
      consecutiveHardwareWrites: previous.consecutiveHardwareWrites,
      lastHardwareWriteAt: previous.lastHardwareWriteAt,
      lastHardwareWriteAction: previous.lastHardwareWriteAction,
    });
  });
}

/**
 * Runs one automation operation under a per-key cross-process lock.
 *
 * @param projectDir - PlatformIO project directory.
 * @param automationKey - Stable automation identifier.
 * @param operation - Work that must not overlap for this key.
 * @returns Operation result.
 */
export async function withAutomationStateLock<T>(
  projectDir: string,
  automationKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  const statePath = getAutomationStatePath(projectDir, automationKey);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  if (!fs.existsSync(statePath)) {
    writeAutomationState(projectDir, createEmptyState(automationKey));
  }

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(statePath, {
      retries: 0,
      stale: 5 * 60 * 1000,
      realpath: false,
    });
  } catch {
    throw new PlatformIOError(
      `Automation '${automationKey}' is already running.`,
      "OVERLAPPING_RUN",
    );
  }

  try {
    return await operation();
  } finally {
    await release();
  }
}
