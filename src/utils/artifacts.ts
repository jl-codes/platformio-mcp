/**
 * Persistent Agent Artifact Utilities
 *
 * Provides:
 * - writeLastAgentReport: Persists the latest agent workflow report.
 * - readLastAgentReport: Loads the latest agent workflow report.
 * - writeBoardReport: Persists board intelligence report output.
 * - readBoardReport: Loads the cached board intelligence report.
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentBoardReport, LastAgentReport } from "../types.js";

const WORKSPACE_DIR = ".pio-mcp-workspace";
const LAST_AGENT_REPORT_FILE = "lastAgentReport.json";
const BOARD_REPORT_FILE = "boardReport.json";

/**
 * Resolves the workspace artifact directory.
 *
 * @param projectDir - Project root directory.
 * @returns Absolute path to `.pio-mcp-workspace`.
 */
export function getWorkspaceArtifactsDir(projectDir: string): string {
  return path.join(projectDir, WORKSPACE_DIR);
}

/**
 * Resolves the file path of the persistent last-agent report.
 *
 * @param projectDir - Project root directory.
 * @returns Absolute file path for `lastAgentReport.json`.
 */
export function getLastAgentReportPath(projectDir: string): string {
  return path.join(getWorkspaceArtifactsDir(projectDir), LAST_AGENT_REPORT_FILE);
}

/**
 * Resolves the file path of the persistent board report.
 *
 * @param projectDir - Project root directory.
 * @returns Absolute file path for `boardReport.json`.
 */
export function getBoardReportPath(projectDir: string): string {
  return path.join(getWorkspaceArtifactsDir(projectDir), BOARD_REPORT_FILE);
}

function ensureArtifactsDir(projectDir: string): void {
  const dir = getWorkspaceArtifactsDir(projectDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJsonFile<T>(filePath: string, payload: T): void {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

/**
 * Persists the latest agent workflow report.
 *
 * @param projectDir - Project root directory.
 * @param report - Agent report payload.
 */
export function writeLastAgentReport(
  projectDir: string,
  report: LastAgentReport,
): void {
  ensureArtifactsDir(projectDir);
  writeJsonFile(getLastAgentReportPath(projectDir), report);
}

/**
 * Reads the latest agent workflow report.
 *
 * @param projectDir - Project root directory.
 * @returns Parsed last-agent report, if present.
 */
export function readLastAgentReport(projectDir: string): LastAgentReport | null {
  return readJsonFile<LastAgentReport>(getLastAgentReportPath(projectDir));
}

/**
 * Persists the board intelligence report.
 *
 * @param projectDir - Project root directory.
 * @param report - Board report payload.
 */
export function writeBoardReport(
  projectDir: string,
  report: AgentBoardReport,
): void {
  ensureArtifactsDir(projectDir);
  writeJsonFile(getBoardReportPath(projectDir), report);
}

/**
 * Reads the cached board intelligence report.
 *
 * @param projectDir - Project root directory.
 * @returns Parsed board report, if present.
 */
export function readBoardReport(projectDir: string): AgentBoardReport | null {
  return readJsonFile<AgentBoardReport>(getBoardReportPath(projectDir));
}
