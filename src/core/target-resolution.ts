/**
 * PlatformIO Target Resolution
 *
 * Provides:
 * - resolveTarget: Resolves one environment, board, and physical device.
 * - verifyTargetBinding: Rejects expired or substituted target bindings.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SerialDevice } from "../types.js";
import { PlatformIOError } from "../utils/errors.js";
import { validateProjectPath } from "../utils/validation.js";
import { listDevicesCore } from "./devices.js";

const MAX_BINDING_TTL_SECONDS = 900;

/** Resolved environment metadata from platformio.ini. */
export interface TargetEnvironment {
  name: string;
  board?: string;
  framework?: string;
}

/** Short-lived proof binding a workflow to one physical target. */
export interface TargetBinding {
  digest: string;
  projectDir: string;
  environment: string;
  board: string;
  port: string;
  deviceFingerprint: string;
  createdAt: string;
  expiresAt: string;
}

/** Target resolution result that reports ambiguity instead of guessing. */
export interface TargetResolutionResult {
  success: boolean;
  status: "resolved" | "ambiguous" | "unavailable" | "invalid_config";
  confidence: "exact" | "high" | "medium" | "none";
  projectDir: string;
  environment?: string;
  board?: string;
  port?: string;
  device?: SerialDevice;
  binding?: TargetBinding;
  candidates: Array<{
    environment?: string;
    board?: string;
    port?: string;
    description?: string;
    deviceFingerprint?: string;
  }>;
  summary: string;
  nextSteps: string[];
}

/**
 * Parses the environment fields required for safe target selection.
 *
 * @param iniText - platformio.ini source text.
 * @returns Declared environments and configured defaults.
 */
export function parseTargetEnvironments(iniText: string): {
  environments: TargetEnvironment[];
  defaults: string[];
} {
  const environments: TargetEnvironment[] = [];
  const defaults: string[] = [];
  let active: TargetEnvironment | undefined;

  for (const rawLine of iniText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;

    const section = /^\[env:([^\]]+)\]$/iu.exec(line);
    if (section) {
      active = { name: section[1].trim() };
      environments.push(active);
      continue;
    }

    const pair = /^([a-zA-Z0-9_]+)\s*=\s*(.+)$/u.exec(line);
    if (!pair) continue;
    const key = pair[1].toLowerCase();
    const value = pair[2].trim();
    if (key === "default_envs") {
      defaults.push(
        ...value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
    } else if (active && key === "board") {
      active.board = value;
    } else if (active && key === "framework") {
      active.framework = value;
    }
  }

  return { environments, defaults };
}

/**
 * Produces a stable, port-independent physical-device fingerprint.
 *
 * @param device - PlatformIO serial device metadata.
 * @returns SHA-256 digest over stable hardware identity fields.
 */
export function fingerprintDevice(device: SerialDevice): string {
  const stableHwid = device.hwid
    .split(/\s+/u)
    .filter((token) => !/^LOCATION=/iu.test(token))
    .sort()
    .join(" ");
  const identity = [
    stableHwid || "NO_HWID",
    device.detectedBoard ?? "UNKNOWN_BOARD",
    device.description || "UNKNOWN_DEVICE",
  ]
    .join("|")
    .toLowerCase();
  return crypto.createHash("sha256").update(identity).digest("hex");
}

/**
 * Creates the signed-content digest for a target binding.
 *
 * @param fields - Immutable binding fields.
 * @returns Stable SHA-256 digest.
 */
function createBindingDigest(fields: Omit<TargetBinding, "digest">): string {
  return crypto
    .createHash("sha256")
    .update(
      [
        fields.projectDir,
        fields.environment,
        fields.board,
        fields.deviceFingerprint,
        fields.createdAt,
        fields.expiresAt,
      ].join("\n"),
    )
    .digest("hex");
}

/**
 * Resolves exactly one PlatformIO target without choosing between peers.
 *
 * @param input - Project, optional selectors, and binding lifetime.
 * @param discoveredDevices - Optional injected device list for deterministic callers.
 * @returns Resolution, ambiguity details, and a short-lived binding.
 */
export async function resolveTarget(
  input: {
    projectDir: string;
    environment?: string;
    port?: string;
    bindingTtlSeconds?: number;
  },
  discoveredDevices?: SerialDevice[],
): Promise<TargetResolutionResult> {
  const projectDir = validateProjectPath(input.projectDir);
  const iniPath = path.join(projectDir, "platformio.ini");
  if (!fs.existsSync(iniPath)) {
    return {
      success: false,
      status: "invalid_config",
      confidence: "none",
      projectDir,
      candidates: [],
      summary: "platformio.ini is missing from the target project.",
      nextSteps: ["Initialize or select a PlatformIO project, then resolve the target again."],
    };
  }

  const parsed = parseTargetEnvironments(fs.readFileSync(iniPath, "utf8"));
  let selectedEnvironment: TargetEnvironment | undefined;
  if (input.environment) {
    selectedEnvironment = parsed.environments.find(
      (item) => item.name === input.environment,
    );
    if (!selectedEnvironment) {
      return {
        success: false,
        status: "invalid_config",
        confidence: "none",
        projectDir,
        candidates: parsed.environments.map((item) => ({
          environment: item.name,
          board: item.board,
        })),
        summary: `Environment '${input.environment}' is not declared in platformio.ini.`,
        nextSteps: ["Choose one of the declared environments and resolve again."],
      };
    }
  } else if (parsed.defaults.length === 1) {
    selectedEnvironment = parsed.environments.find(
      (item) => item.name === parsed.defaults[0],
    );
  } else if (parsed.environments.length === 1) {
    selectedEnvironment = parsed.environments[0];
  }

  if (!selectedEnvironment) {
    return {
      success: false,
      status: "ambiguous",
      confidence: "none",
      projectDir,
      candidates: parsed.environments.map((item) => ({
        environment: item.name,
        board: item.board,
      })),
      summary: "Multiple PlatformIO environments are plausible.",
      nextSteps: ["Pass an explicit environment and resolve the target again."],
    };
  }

  if (!selectedEnvironment.board) {
    return {
      success: false,
      status: "invalid_config",
      confidence: "none",
      projectDir,
      environment: selectedEnvironment.name,
      candidates: [],
      summary: `Environment '${selectedEnvironment.name}' does not declare a board.`,
      nextSteps: ["Add a board setting to the selected environment."],
    };
  }

  const devices = (discoveredDevices ?? (await listDevicesCore())).filter((device) => {
    const normalizedPort = device.port.toLowerCase();
    return !normalizedPort.includes("bluetooth") && !normalizedPort.includes("blth");
  });
  let candidates = input.port
    ? devices.filter((device) => device.port === input.port)
    : devices.filter(
        (device) =>
          device.detectedBoard?.toLowerCase() ===
          selectedEnvironment?.board?.toLowerCase(),
      );
  let confidence: TargetResolutionResult["confidence"] = "exact";

  if (!input.port && candidates.length === 0 && devices.length === 1) {
    candidates = devices;
    confidence = "medium";
  } else if (!input.port && candidates.length === 1) {
    confidence = "high";
  }

  if (candidates.length === 0) {
    return {
      success: false,
      status: "unavailable",
      confidence: "none",
      projectDir,
      environment: selectedEnvironment.name,
      board: selectedEnvironment.board,
      candidates: devices.map((device) => ({
        port: device.port,
        description: device.description,
        board: device.detectedBoard,
        deviceFingerprint: fingerprintDevice(device),
      })),
      summary: input.port
        ? `No attached device is present at '${input.port}'.`
        : "No attached device can be resolved for the selected board.",
      nextSteps: ["Connect the target board or pass the exact port, then resolve again."],
    };
  }

  if (candidates.length > 1) {
    return {
      success: false,
      status: "ambiguous",
      confidence: "none",
      projectDir,
      environment: selectedEnvironment.name,
      board: selectedEnvironment.board,
      candidates: candidates.map((device) => ({
        port: device.port,
        description: device.description,
        board: device.detectedBoard,
        deviceFingerprint: fingerprintDevice(device),
      })),
      summary: "Multiple physical devices match the selected target.",
      nextSteps: ["Choose one exact port and resolve again before any write operation."],
    };
  }

  const device = candidates[0];
  const ttlSeconds = Math.min(
    MAX_BINDING_TTL_SECONDS,
    Math.max(30, input.bindingTtlSeconds ?? 300),
  );
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const bindingFields: Omit<TargetBinding, "digest"> = {
    projectDir,
    environment: selectedEnvironment.name,
    board: selectedEnvironment.board,
    port: device.port,
    deviceFingerprint: fingerprintDevice(device),
    createdAt,
    expiresAt,
  };
  const binding: TargetBinding = {
    ...bindingFields,
    digest: createBindingDigest(bindingFields),
  };

  return {
    success: true,
    status: "resolved",
    confidence,
    projectDir,
    environment: selectedEnvironment.name,
    board: selectedEnvironment.board,
    port: device.port,
    device,
    binding,
    candidates: [],
    summary: `Resolved ${selectedEnvironment.name} on ${device.port}.`,
    nextSteps: ["Use this target binding before it expires for flash or monitoring."],
  };
}

/**
 * Verifies a binding against current project and device identity.
 *
 * @param binding - Previously resolved target binding.
 * @param input - Current operation scope and optional discovered devices.
 * @returns The current port, including a safe re-enumerated port when found.
 */
export async function verifyTargetBinding(
  binding: TargetBinding,
  input: {
    projectDir: string;
    environment: string;
    devices?: SerialDevice[];
  },
): Promise<{ valid: true; port: string; portChanged: boolean }> {
  const projectDir = validateProjectPath(input.projectDir);
  const expectedDigest = createBindingDigest({
    projectDir: binding.projectDir,
    environment: binding.environment,
    board: binding.board,
    port: binding.port,
    deviceFingerprint: binding.deviceFingerprint,
    createdAt: binding.createdAt,
    expiresAt: binding.expiresAt,
  });
  if (expectedDigest !== binding.digest) {
    throw new PlatformIOError("Target binding digest is invalid.", "STALE_TARGET_BINDING");
  }
  if (new Date(binding.expiresAt).getTime() <= Date.now()) {
    throw new PlatformIOError("Target binding has expired.", "STALE_TARGET_BINDING");
  }
  if (
    binding.projectDir !== projectDir ||
    binding.environment !== input.environment
  ) {
    throw new PlatformIOError(
      "Target binding does not match the current project and environment.",
      "STALE_TARGET_BINDING",
    );
  }

  const devices = input.devices ?? (await listDevicesCore());
  const matching = devices.filter(
    (device) => fingerprintDevice(device) === binding.deviceFingerprint,
  );
  if (matching.length !== 1) {
    throw new PlatformIOError(
      matching.length === 0
        ? "The bound device is no longer attached."
        : "The bound device identity is ambiguous.",
      matching.length === 0 ? "STALE_TARGET_BINDING" : "AMBIGUOUS_TARGET",
    );
  }

  return {
    valid: true,
    port: matching[0].port,
    portChanged: matching[0].port !== binding.port,
  };
}
