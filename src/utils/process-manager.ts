/**
 * OS Process Management Utilities
 * Tools for identifying and terminating conflicting serial port owners.
 *
 * Provides:
 * - registerPioMonitorPid: Records a PID to the workspace for crash resumption.
 * - unregisterPioMonitorPid: Removes a PID from the file tracker.
 * - killPioMonitorByPort: Safely terminates a tracked PID using tree-kill.
 */

import fs from "node:fs";
import {
  inspectProcessIdentity,
  compareProcessIdentity,
  type ProcessIdentity,
} from "../core/devices/process-identity.js";
import { PlatformIOError } from "./errors.js";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import treeKill from "tree-kill";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { logDiagnostic as logDiag } from "./logger.js";
import {
  registerCommand,
  updateTaskStatus,
  getCommandHistory,
} from "./command-registry.js";
import type { TaskRecord } from "./command-registry.js";
import crypto from "node:crypto";
import {
  SERVER_DATA_DIR,
  ensureGlobalDirs,
  canonicalPortName,
} from "./paths.js";

const WORKSPACE_DIR = ".pio-mcp-workspace";
const LOCKS_DIR = "locks";
const SERIAL_PIDS_FILE = "monitor-pids.json";
const BUILD_PIDS_FILE = "active_tasks.json";

/** Optional durable monitor context, independent of the rotating command history. */
export interface MonitorRegistrationDetails {
  baudRate?: number; // Effective unfiltered serial baud rate.
  environment?: string; // Project-defined monitor environment.
  startedAt?: string; // ISO timestamp of the monitor's startup.
}

/** Read-only monitor record whose process start identity has been checked. */
export interface PersistedMonitorStatus extends MonitorRegistrationDetails {
  port: string; // Canonical endpoint selector.
  pid: number; // Persisted child PID, not authority to terminate it.
  state: "active" | "stale"; // Unknown identity is conservatively stale.
  projectDir?: string; // Exact owning workspace, if durably recorded.
  logFile?: string; // Spool file associated with this child.
  taskId?: string; // Stable monitor task identifier.
}

const ProcessIdentitySchema = z.object({
  pid: z.number().int().min(1).max(2147483647),
  platform: z.enum([
    "aix",
    "android",
    "darwin",
    "freebsd",
    "haiku",
    "linux",
    "openbsd",
    "sunos",
    "win32",
    "cygwin",
    "netbsd",
  ]),
  startToken: z.string().min(1).max(8192),
});
const MonitorMetadataSchema = z.object({
  pid: z.number().int().min(1).max(2147483647),
  identity: ProcessIdentitySchema.optional(),
  projectDir: z.string().min(1).max(32768).optional(),
  logFile: z.string().min(1).max(32768).optional(),
  taskId: z.string().min(1).max(512).optional(),
  startedAt: z.string().datetime().optional(),
  baudRate: z.number().int().positive().max(10000000).optional(),
  environment: z.string().min(1).max(512).optional(),
});
type MonitorMetadata = z.infer<typeof MonitorMetadataSchema>;

/** Read bounded registry JSON without creating files or recovering ownership. */
function readMonitorRegistry<T>(
  file: string,
  schema: z.ZodType<T>,
  empty: unknown = {},
): T {
  try {
    if (!fs.existsSync(file)) return schema.parse(empty);
    if (fs.statSync(file).size > 1024 * 1024)
      throw new Error("Registry exceeds limits");
    return schema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    throw new PlatformIOError(
      "Persisted monitor registry is unreadable or invalid.",
      "MONITOR_REGISTRY_INVALID",
      { file, detail: error instanceof Error ? error.message : undefined },
    );
  }
}

/** Recover pre-metadata context only from a PID-and-port-matched task in the selected registry. */
function readLegacyMonitorContext(
  port: string,
  pid: number,
  projectDir?: string,
): MonitorMetadata | undefined {
  const file = path.join(
    projectDir ? path.resolve(projectDir) : SERVER_DATA_DIR,
    WORKSPACE_DIR,
    "registry",
    "command_history.json",
  );
  const history = readMonitorRegistry(
    file,
    z.array(
      z.object({
        timestamp: z.number().finite().nonnegative().max(8640000000000000),
        tasks: z.array(
          z.object({
            type: z.string(),
            status: z.string(),
            pid: z.number().int().positive().optional(),
            port: z.string().max(512).optional(),
            taskId: z.string().max(512).optional(),
            logPaths: z.array(z.string().min(1).max(32768)).optional(),
          }),
        ),
      }),
    ),
    [],
  );
  for (const command of [...history].reverse()) {
    const task = command.tasks.find(
      (candidate) =>
        candidate.type === "monitor" &&
        candidate.status === "running" &&
        candidate.pid === pid &&
        sameMonitorPort(candidate.port, port),
    );
    if (task)
      return {
        pid,
        projectDir: projectDir ? path.resolve(projectDir) : undefined,
        taskId: task.taskId,
        logFile: task.logPaths?.[0],
        startedAt: new Date(command.timestamp).toISOString(),
      };
  }
  return undefined;
}

/**
 * Gets the absolute path to the PID tracking file.
 */
function getPidsFilePath(
  projectDir?: string,
  file: string = SERIAL_PIDS_FILE,
): string {
  if (file === SERIAL_PIDS_FILE) {
    // Serial ports are global OS-level hardware resources.
    // Tracking them globally prevents Project B from attempting to open a port held by Project A.
    ensureGlobalDirs();
    const dir = path.join(SERVER_DATA_DIR, "serial_monitors");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, file);
  } else if (file === BUILD_PIDS_FILE) {
    // Build tasks are strictly scoped to the project environment
    const baseDir = projectDir || SERVER_DATA_DIR;
    if (!projectDir) ensureGlobalDirs();
    const dir = path.join(baseDir, WORKSPACE_DIR, "tasks");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, file);
  }
  const baseDir = projectDir || SERVER_DATA_DIR;
  if (!projectDir) ensureGlobalDirs();
  return path.join(baseDir, WORKSPACE_DIR, LOCKS_DIR, file);
}

/** Read bounded supplemental start identities; legacy numeric PID files remain unchanged. */
function readMonitorIdentities(
  pidsFile: string,
): Record<string, ProcessIdentity> {
  const file = pidsFile + ".identities.json";
  if (!fs.existsSync(file)) return {};
  if (fs.statSync(file).size > 1024 * 1024)
    throw new PlatformIOError(
      "Monitor identity registry exceeds limits.",
      "PROCESS_IDENTITY_INVALID",
    );
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PlatformIOError(
      "Invalid monitor identity registry.",
      "PROCESS_IDENTITY_INVALID",
    );
  return value;
}

/** Find canonical and legacy alias entries without losing unrelated unplugged monitors. */
function monitorRegistryKeys(
  pids: Record<string, number>,
  port: string,
): string[] {
  const canonical = canonicalPortName(port);
  return Object.keys(pids).filter((key) => {
    if (key === port || key === canonical) return true;
    try {
      return canonicalPortName(key) === canonical;
    } catch {
      return false;
    }
  });
}

/** Compare persisted task selectors against canonical registry keys. */
function sameMonitorPort(candidate: string | undefined, port: string): boolean {
  if (!candidate) return false;
  if (candidate === port) return true;
  try {
    return canonicalPortName(candidate) === canonicalPortName(port);
  } catch {
    return false;
  }
}

/**
 * Records a given process ID belonging to a started serial monitor.
 */
export async function registerPioMonitorPid(
  port: string,
  pid: number,
  projectDir?: string,
  rootCommandId?: string,
  logFile?: string,
  taskId?: string,
  commandDesc?: string,
  details: MonitorRegistrationDetails = {},
): Promise<void> {
  const canonicalPort = canonicalPortName(port);
  const pidsFile = getPidsFilePath(projectDir);
  const dir = path.dirname(pidsFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(pidsFile)) fs.writeFileSync(pidsFile, "{}");

  try {
    const release = await lockfile.lock(pidsFile, {
      retries: { retries: 5, minTimeout: 50, maxTimeout: 200 },
    });
    try {
      let pids: Record<string, number> = {};
      try {
        pids = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
      } catch {}
      const identities = readMonitorIdentities(pidsFile);
      const metadata = readMonitorRegistry(
        pidsFile + ".metadata.json",
        z.record(MonitorMetadataSchema),
      );
      const matchingKeys = monitorRegistryKeys(pids, canonicalPort);
      for (const key of matchingKeys) {
        if (
          pids[key] !== pid &&
          inspectProcessIdentity(pids[key]).status !== "absent"
        )
          throw new PlatformIOError(
            "A different monitor still owns this serial endpoint.",
            "PROCESS_REGISTRATION_CONFLICT",
            { port: canonicalPort },
          );
      }
      for (const key of matchingKeys) {
        delete pids[key];
        delete identities[key];
        delete metadata[key];
      }
      const observed = inspectProcessIdentity(pid);
      if (observed.status === "running")
        identities[canonicalPort] = observed.identity;
      else delete identities[canonicalPort];
      metadata[canonicalPort] = MonitorMetadataSchema.parse({
        pid,
        identity: observed.status === "running" ? observed.identity : undefined,
        projectDir: projectDir ? path.resolve(projectDir) : undefined,
        logFile,
        taskId,
        startedAt: details.startedAt ?? new Date().toISOString(),
        baudRate: details.baudRate,
        environment: details.environment,
      });
      fs.writeFileSync(
        pidsFile + ".metadata.json",
        JSON.stringify(metadata, null, 2),
      );
      fs.writeFileSync(
        pidsFile + ".identities.json",
        JSON.stringify(identities, null, 2),
      );
      pids[canonicalPort] = pid;
      fs.writeFileSync(pidsFile, JSON.stringify(pids, null, 2));
    } finally {
      await release();
    }
  } catch (e: any) {
    if (e instanceof PlatformIOError) throw e;
    throw new Error(`Registry contention timeout: ${e.message}`);
  }

  try {
    const commandId = rootCommandId || crypto.randomUUID();
    const effectiveTaskId = taskId || crypto.randomUUID();

    await registerCommand(
      {
        id: commandId,
        commandDesc: `PIO Serial Monitor: ${port}`,
        timestamp: Date.now(),
        status: "running",
        tasks: [
          {
            taskId: effectiveTaskId,
            type: "monitor",
            status: "running",
            port: port,
            pid: pid,
            commandDesc: commandDesc,
            logPaths: logFile ? [logFile] : [],
          },
        ],
      },
      projectDir,
    );
  } catch (e: any) {
    logDiag(
      `[ProcessManager] Failed to register monitor command: ${e.message}`,
      projectDir,
    );
  }
}

/**
 * Removes the recorded PID tracking for a specific port.
 */
export async function unregisterPioMonitorPid(
  port: string,
  projectDir?: string,
): Promise<void> {
  const canonicalPort = canonicalPortName(port);
  const pidsFile = getPidsFilePath(projectDir, SERIAL_PIDS_FILE);

  if (fs.existsSync(pidsFile)) {
    try {
      const release = await lockfile.lock(pidsFile, {
        retries: { retries: 5, minTimeout: 50, maxTimeout: 200 },
      });
      try {
        const pids: Record<string, number> = JSON.parse(
          fs.readFileSync(pidsFile, "utf8"),
        );
        const matchingKeys = monitorRegistryKeys(pids, canonicalPort);
        if (matchingKeys.length > 0) {
          const identities = readMonitorIdentities(pidsFile);
          const metadata = readMonitorRegistry(
            pidsFile + ".metadata.json",
            z.record(MonitorMetadataSchema),
          );
          for (const key of matchingKeys) {
            delete pids[key];
            delete identities[key];
            delete metadata[key];
          }
          fs.writeFileSync(
            pidsFile + ".identities.json",
            JSON.stringify(identities, null, 2),
          );
          fs.writeFileSync(pidsFile, JSON.stringify(pids, null, 2));
          fs.writeFileSync(
            pidsFile + ".metadata.json",
            JSON.stringify(metadata, null, 2),
          );
        }
      } finally {
        await release();
      }
    } catch (e: any) {
      throw new Error(`Registry contention timeout: ${e.message}`);
    }
  }

  try {
    const history = getCommandHistory(projectDir);
    // Find the command that contains an actively running monitor task for this port
    const activeCommand = [...history]
      .reverse()
      .find((cmd) =>
        cmd.tasks?.some(
          (a) =>
            a.type === "monitor" &&
            a.status === "running" &&
            sameMonitorPort(a.port, canonicalPort),
        ),
      );
    if (activeCommand) {
      const activeTask = activeCommand.tasks.find(
        (a) =>
          a.type === "monitor" &&
          a.status === "running" &&
          sameMonitorPort(a.port, canonicalPort),
      );
      if (activeTask) {
        await updateTaskStatus(
          activeCommand.id,
          activeTask.taskId,
          { status: "terminated" },
          projectDir,
        );
      }
    }
  } catch (e: any) {
    logDiag(
      `[ProcessManager] Failed to update monitor command status: ${e.message}`,
      projectDir,
    );
  }
}

/**
 * Target-kills a stray or explicitly stopped monitor process via tree-kill.
 */
export async function killPioMonitorByPort(
  port: string,
  projectDir?: string,
): Promise<boolean> {
  const canonicalPort = canonicalPortName(port);
  const pidsFile = getPidsFilePath(projectDir, SERIAL_PIDS_FILE);
  if (!fs.existsSync(pidsFile)) return false;
  let stoppedPid: number | undefined;
  const release = await lockfile.lock(pidsFile, {
    retries: { retries: 5, minTimeout: 50, maxTimeout: 200 },
  });
  try {
    const pids = JSON.parse(fs.readFileSync(pidsFile, "utf8")) as Record<
      string,
      number
    >;
    const matchingKeys = monitorRegistryKeys(pids, canonicalPort);
    if (matchingKeys.length === 0) return false;
    const matchingPids = new Set(matchingKeys.map((key) => pids[key]));
    if (matchingPids.size !== 1)
      throw new PlatformIOError(
        "Conflicting monitor processes are recorded for this serial endpoint.",
        "PROCESS_IDENTITY_UNVERIFIED",
        { port: canonicalPort },
      );
    const pid = pids[matchingKeys[0]];
    stoppedPid = pid;
    const recordedIdentities = readMonitorIdentities(pidsFile);
    const identity = matchingKeys
      .map((key) => recordedIdentities[key])
      .find((value) => value?.pid === pid);
    const observation = inspectProcessIdentity(pid);
    if (observation.status === "absent") {
      /* Nothing remains to terminate. */
    } else {
      if (
        !identity ||
        identity.pid !== pid ||
        compareProcessIdentity(identity, observation) !== "alive"
      )
        throw new PlatformIOError(
          "Monitor process identity is unavailable or changed; refusing PID-only termination.",
          "PROCESS_IDENTITY_UNVERIFIED",
        );
      await new Promise<void>((resolve, reject) =>
        treeKill(pid, "SIGKILL", (error) =>
          error ? reject(error) : resolve(),
        ),
      );
      let confirmed = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        if (
          compareProcessIdentity(identity, inspectProcessIdentity(pid)) ===
          "stale"
        ) {
          confirmed = true;
          break;
        }
        await delay(50);
      }
      if (!confirmed)
        throw new PlatformIOError(
          "Monitor exit could not be confirmed.",
          "PROCESS_CLEANUP_PENDING",
        );
    }
    const identities = readMonitorIdentities(pidsFile);
    const metadata = readMonitorRegistry(
      pidsFile + ".metadata.json",
      z.record(MonitorMetadataSchema),
    );
    for (const key of matchingKeys) {
      delete pids[key];
      delete identities[key];
      delete metadata[key];
    }
    fs.writeFileSync(
      pidsFile + ".identities.json",
      JSON.stringify(identities, null, 2),
    );
    fs.writeFileSync(pidsFile, JSON.stringify(pids, null, 2));
    fs.writeFileSync(
      pidsFile + ".metadata.json",
      JSON.stringify(metadata, null, 2),
    );
  } finally {
    await release();
  }
  const history = getCommandHistory(projectDir);
  for (const command of history) {
    for (const task of command.tasks ?? []) {
      if (
        task.type === "monitor" &&
        sameMonitorPort(task.port, canonicalPort) &&
        task.pid === stoppedPid &&
        task.status === "running"
      )
        await updateTaskStatus(
          command.id,
          task.taskId,
          { status: "terminated" },
          projectDir,
        );
    }
  }
  return true;
}

/**
 * OS-level check to verify if a PID is actively running PlatformIO/Python.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Throws if process is dead
    if (os.platform() !== "win32") {
      try {
        const stdout = execSync(`ps -p ${pid} -o command=`, {
          encoding: "utf8",
        }).toLowerCase();
        if (
          !stdout.includes("platformio") &&
          !stdout.includes("pio") &&
          !stdout.includes("python")
        ) {
          return false;
        }
        try {
          const stat = execSync(`ps -p ${pid} -o stat=`, { encoding: "utf8" })
            .trim()
            .toUpperCase();
          if (stat.startsWith("Z")) {
            return false;
          }
        } catch {}
      } catch {
        // ps fails -> process probably dead or inaccessible
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the raw track-list of active monitor daemon PIDs for a specific workspace.
 */
export function getActiveMonitorPids(
  projectDir?: string,
): Record<string, number> {
  const pidsFile = getPidsFilePath(projectDir, SERIAL_PIDS_FILE);
  if (!fs.existsSync(pidsFile)) return {};
  try {
    const persisted = JSON.parse(fs.readFileSync(pidsFile, "utf8")) as Record<
      string,
      number
    >;
    const canonical: Record<string, number> = {};
    for (const [port, pid] of Object.entries(persisted)) {
      let key = port;
      try {
        key = canonicalPortName(port);
      } catch {
        /* Preserve unplugged legacy aliases. */
      }
      if (canonical[key] !== undefined && canonical[key] !== pid)
        throw new PlatformIOError(
          "Conflicting monitor aliases in PID registry.",
          "PROCESS_IDENTITY_UNVERIFIED",
        );
      canonical[key] = pid;
    }
    return canonical;
  } catch {
    return {};
  }
}

/**
 * Reads durable monitor context and verifies the exact child start identity.
 * This query neither starts watchers nor creates, recovers, or removes registry records.
 * @param projectDir - Optional exact owning workspace selector.
 * @returns Canonical monitor records; missing or unverifiable identities remain stale.
 */
export function getPersistedMonitorStatuses(
  projectDir?: string,
): PersistedMonitorStatus[] {
  const pidsFile = path.join(
    SERVER_DATA_DIR,
    "serial_monitors",
    SERIAL_PIDS_FILE,
  );
  const pids = readMonitorRegistry(
    pidsFile,
    z.record(z.number().int().min(1).max(2147483647)),
  );
  const identities = readMonitorRegistry(
    pidsFile + ".identities.json",
    z.record(ProcessIdentitySchema),
  );
  const metadata = readMonitorRegistry(
    pidsFile + ".metadata.json",
    z.record(MonitorMetadataSchema),
  );
  const records = new Map<
    string,
    { keys: string[]; pid: number; resolved: boolean }
  >();
  for (const [port, pid] of Object.entries(pids)) {
    let canonical = port;
    let resolved = true;
    try {
      canonical = canonicalPortName(port);
    } catch {
      resolved = false;
    }
    const previous = records.get(canonical);
    if (previous && previous.pid !== pid) {
      throw new PlatformIOError(
        "Conflicting monitor aliases in PID registry.",
        "MONITOR_REGISTRY_INVALID",
        { port: canonical },
      );
    }
    if (previous) previous.keys.push(port);
    else records.set(canonical, { keys: [port], pid, resolved });
  }
  const statuses: PersistedMonitorStatus[] = [];
  for (const [port, record] of records) {
    const identity = record.keys
      .map((key) => identities[key])
      .find((value) => value?.pid === record.pid);
    const hasMetadata = record.keys.some((key) => metadata[key] !== undefined);
    const context: MonitorMetadata | undefined =
      record.keys
        .map((key) => metadata[key])
        .find(
          (value) =>
            value?.pid === record.pid &&
            value.identity?.pid === identity?.pid &&
            value.identity?.platform === identity?.platform &&
            value.identity?.startToken === identity?.startToken,
        ) ??
      (!hasMetadata
        ? readLegacyMonitorContext(port, record.pid, projectDir)
        : undefined);
    const owningProject = context?.projectDir
      ? path.resolve(context.projectDir)
      : undefined;
    const selectedProject = projectDir ? path.resolve(projectDir) : undefined;
    const sameProject =
      process.platform === "win32"
        ? owningProject?.toLowerCase() === selectedProject?.toLowerCase()
        : owningProject === selectedProject;
    if (projectDir && !sameProject) continue;
    const proven =
      record.resolved &&
      identity &&
      (!hasMetadata || context) &&
      compareProcessIdentity(identity, inspectProcessIdentity(record.pid)) ===
        "alive";
    statuses.push({
      port,
      pid: record.pid,
      state: proven ? "active" : "stale",
      projectDir: context?.projectDir,
      logFile: context?.logFile,
      taskId: context?.taskId,
      startedAt: context?.startedAt,
      baudRate: context?.baudRate,
      environment: context?.environment,
    });
  }
  return statuses;
}

/**
 * Checks if a build is currently tracked and actively running.
 */
export function isBuildActive(projectDir?: string): boolean {
  const pidsFile = getPidsFilePath(projectDir, BUILD_PIDS_FILE);
  if (!fs.existsSync(pidsFile)) return false;
  try {
    const pids: Record<string, any> = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
    for (const key of Object.keys(pids)) {
      if (pids[key]?.type === "build" || key === "build") {
        const targetPid = key === "build" ? pids[key] : Number(key);
        if (isPidAlive(targetPid)) return true;
      }
    }
  } catch {}
  return false;
}

export async function registerBuildPid(pid: number, projectDir?: string): Promise<void> {
  const pidsFile = getPidsFilePath(projectDir, BUILD_PIDS_FILE);
  const dir = path.dirname(pidsFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(pidsFile)) fs.writeFileSync(pidsFile, "{}");

  try {
    const release = await lockfile.lock(pidsFile, { retries: { retries: 5, minTimeout: 50, maxTimeout: 200 } });
    try {
      let pids: Record<string, any> = {};
      try {
        pids = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
      } catch {}
      pids[pid.toString()] = { type: "build", started: Date.now() };
      fs.writeFileSync(pidsFile, JSON.stringify(pids, null, 2));
    } finally {
      await release();
    }
  } catch (e: any) {
    throw new Error(`Registry contention timeout: ${e.message}`);
  }
}

export async function unregisterBuildPid(projectDir?: string): Promise<void> {
  const pidsFile = getPidsFilePath(projectDir, BUILD_PIDS_FILE);
  if (!fs.existsSync(pidsFile)) return;

  try {
    const release = await lockfile.lock(pidsFile, { retries: { retries: 5, minTimeout: 50, maxTimeout: 200 } });
    try {
      const pids: Record<string, any> = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
      let changed = false;
      for (const key of Object.keys(pids)) {
        if (pids[key]?.type === "build" || key === "build") {
          delete pids[key];
          changed = true;
        }
      }
      if (changed) {
        fs.writeFileSync(pidsFile, JSON.stringify(pids, null, 2));
      }
    } finally {
      await release();
    }
  } catch (e: any) {
    throw new Error(`Registry contention timeout: ${e.message}`);
  }
}

/**
 * Removes one exact build PID from the project tracker.
 *
 * @param pid - Tracked build process ID.
 * @param projectDir - Owning project directory.
 * @returns Resolves after the tracker is updated.
 */
async function unregisterBuildPidValue(
  pid: number,
  projectDir?: string,
): Promise<void> {
  const pidsFile = getPidsFilePath(projectDir, BUILD_PIDS_FILE);
  if (!fs.existsSync(pidsFile)) return;
  const release = await lockfile.lock(pidsFile, {
    retries: { retries: 5, minTimeout: 50, maxTimeout: 200 },
  });
  try {
    const pids = JSON.parse(fs.readFileSync(pidsFile, "utf8")) as Record<
      string,
      unknown
    >;
    delete pids[String(pid)];
    fs.writeFileSync(pidsFile, JSON.stringify(pids, null, 2));
  } finally {
    await release();
  }
}

/**
 * Terminates one process only after proving it belongs to the selected task.
 *
 * @param task - Persisted task record containing PID and hardware scope.
 * @param projectDir - Owning project directory.
 * @returns Whether a live tracked process was terminated.
 */
export async function killTrackedTaskProcess(
  task: TaskRecord,
  projectDir?: string,
): Promise<boolean> {
  if (!task.pid) return false;

  const monitorPids = getActiveMonitorPids(projectDir);
  const buildPidsFile = getPidsFilePath(projectDir, BUILD_PIDS_FILE);
  let buildPids: Record<string, unknown> = {};
  if (fs.existsSync(buildPidsFile)) {
    try {
      buildPids = JSON.parse(fs.readFileSync(buildPidsFile, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      buildPids = {};
    }
  }

  const trackedMonitor =
    task.type === "monitor" &&
    Boolean(task.port) &&
    monitorPids[canonicalPortName(task.port!)] === task.pid;
  const trackedBuild =
    task.type !== "monitor" && Object.hasOwn(buildPids, String(task.pid));
  if (!trackedMonitor && !trackedBuild) {
    if (!isPidAlive(task.pid)) return false;
    throw new Error(
      `Refusing to terminate PID ${task.pid}; it is not owned by task ${task.taskId}.`,
    );
  }

  if (isPidAlive(task.pid)) {
    await new Promise<void>((resolve, reject) => {
      treeKill(task.pid!, "SIGTERM", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  if (trackedMonitor && task.port) {
    await unregisterPioMonitorPid(task.port, projectDir);
  } else if (trackedBuild) {
    await unregisterBuildPidValue(task.pid, projectDir);
  }
  return true;
}

/**
 * Wipes out all stray tracked processes across serial instances and builds.
 * Specifically used by emergency reset routines to return the system to a clean state.
 */
export async function killAllTrackedProcesses(projectDir?: string): Promise<void> {
  const tasks: Promise<void>[] = [];
  
  for (const file of [SERIAL_PIDS_FILE, BUILD_PIDS_FILE]) {
    const pidsFile = getPidsFilePath(projectDir, file);
    if (fs.existsSync(pidsFile)) {
      try {
        const pids: Record<string, any> = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
        for (const key of Object.keys(pids)) {
          let targetPid: number | undefined;
          if (file === BUILD_PIDS_FILE) {
            if (pids[key]?.type === "build" || key === "build") {
              targetPid = key === "build" ? pids[key] : Number(key);
            }
          } else {
            targetPid = pids[key];
          }
          if (targetPid) {
            logDiag(`[ProcessManager Diagnostic] Emergency killing tracked PID ${targetPid} via ${file}.`, projectDir);
            const p = new Promise<void>((res) => {
              treeKill(targetPid!, "SIGKILL", () => res());
            });
            tasks.push(p);
          }
        }
        fs.unlinkSync(pidsFile);
      } catch {}
    }
  }
  
  await Promise.all(tasks);
  
  // Ensure the command registry is immediately synchronized with reality
  await sweepGhostTasks(projectDir);
}

/**
 * Scans the command history and forcefully terminates any task that is marked as 'running'
 * but no longer has an active matching OS-level process.
 */
export async function sweepGhostTasks(projectDir?: string): Promise<void> {
  try {
    const history = getCommandHistory(projectDir);
    let changed = false;

    for (const cmd of history) {
      if (cmd.tasks) {
        for (const task of cmd.tasks) {
          if (task.status === "running") {
            const pid = task.pid;
            let isAlive = false;
            if (pid && isPidAlive(pid)) {
              isAlive = true;
            }

            if (!isAlive) {
              // Task is dead! Force transition to terminated
              await updateTaskStatus(cmd.id, task.taskId, { status: "terminated" }, projectDir);
              logDiag(`[Ghost Sweeper] Cleaned up orphaned ghost task ${task.taskId} (PID: ${pid || 'Unknown'})`, projectDir);
              changed = true;
            }
          }
        }
      }
    }
    
    if (changed) {
      logDiag(`[Ghost Sweeper] Successfully scrubbed stale background tasks from registry.`, projectDir);
    }
  } catch (e: any) {
    logDiag(`[Ghost Sweeper] Failed to sweep tasks: ${e.message}`, projectDir);
  }
}
