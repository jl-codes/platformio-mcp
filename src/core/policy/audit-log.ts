import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AuditEvent } from "./types.js";
import { SERVER_DATA_DIR } from "../../utils/paths.js";

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function appendAuditEvent(
  input: Omit<AuditEvent, "id" | "timestamp"> & { timestamp?: string },
) {
  const event: AuditEvent = {
    id: crypto.randomUUID(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    ...input,
  };

  const globalDir = path.join(SERVER_DATA_DIR, "audit");
  ensureDir(globalDir);
  const globalFile = path.join(globalDir, "global-events.jsonl");
  fs.appendFileSync(globalFile, JSON.stringify(event) + "\n", "utf8");

  if (input.workspaceDir) {
    const localDir = path.join(
      input.workspaceDir,
      ".pio-mcp-workspace",
      "audit",
    );
    ensureDir(localDir);
    const localFile = path.join(localDir, "events.jsonl");
    fs.appendFileSync(localFile, JSON.stringify(event) + "\n", "utf8");
  }

  return event;
}

export function readRecentAuditEvents(
  opts?: { workspaceDir?: string; limit?: number },
): AuditEvent[] {
  const limit = Math.max(1, opts?.limit ?? 50);
  const globalFile = path.join(SERVER_DATA_DIR, "audit", "global-events.jsonl");
  const localFile = opts?.workspaceDir
    ? path.join(opts.workspaceDir, ".pio-mcp-workspace", "audit", "events.jsonl")
    : undefined;
  const sourceFile = localFile && fs.existsSync(localFile) ? localFile : globalFile;

  if (!fs.existsSync(sourceFile)) {
    return [];
  }

  const lines = fs
    .readFileSync(sourceFile, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  const events: AuditEvent[] = [];
  for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
    try {
      events.push(JSON.parse(lines[i]) as AuditEvent);
    } catch {
      // Ignore malformed lines and continue.
    }
  }

  return events;
}
