/**
 * Monitoring Automation State
 *
 * Provides:
 * - readAutomationState: Reads bounded change-detection state.
 * - writeAutomationState: Atomically persists state without log evidence.
 * - withAutomationStateLock: Prevents overlapping runs for one automation key.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import type { TargetBinding } from "./target-resolution.js";
import { PlatformIOError } from "../utils/errors.js";
import { validateProjectPath } from "../utils/validation.js";

const MAX_STATE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Persisted state used to make scheduled monitoring change-aware. */
export interface AutomationState {
  schemaVersion: 1;
  automationKey: string;
  cursor?: string;
  digest?: string;
  lastStatus?: string;
  consecutiveFailures: number;
  targetBinding?: TargetBinding;
  createdAt: string;
  updatedAt: string;
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
function createEmptyState(automationKey: string, now = new Date()): AutomationState {
  const timestamp = now.toISOString();
  return {
    schemaVersion: 1,
    automationKey,
    consecutiveFailures: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
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
  const statePath = getAutomationStatePath(projectDir, automationKey);
  if (!fs.existsSync(statePath)) return createEmptyState(automationKey);

  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as AutomationState;
    const updatedAt = new Date(state.updatedAt).getTime();
    if (
      state.schemaVersion !== 1 ||
      state.automationKey !== automationKey ||
      !Number.isFinite(updatedAt) ||
      Date.now() - updatedAt > MAX_STATE_AGE_MS
    ) {
      return createEmptyState(automationKey);
    }
    return state;
  } catch {
    return createEmptyState(automationKey);
  }
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
  return nextState;
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
