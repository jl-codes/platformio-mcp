import fs from "node:fs";
import { startMonitor } from "../tools/monitor.js";

export type StartMonitorCoreInput = {
  port?: string;
  baudRate?: number;
  projectDir?: string;
  environment?: string;
};

export async function startMonitorCore(input: StartMonitorCoreInput) {
  return startMonitor(
    input.port,
    input.baudRate,
    input.projectDir,
    input.environment,
  );
}

export type MonitorUntilExpectInput = {
  logFile: string;
  expect: string;
  timeoutSeconds: number;
  pollMs?: number;
};

export async function waitForExpectedSerialOutput(
  input: MonitorUntilExpectInput,
): Promise<{ matched: boolean; matchedAt?: string; elapsedMs: number }> {
  const startedAt = Date.now();
  const pollMs = input.pollMs ?? 500;
  const timeoutMs = Math.max(1, input.timeoutSeconds) * 1000;

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      if (fs.existsSync(input.logFile)) {
        const content = fs.readFileSync(input.logFile, "utf8");
        if (content.includes(input.expect)) {
          return {
            matched: true,
            matchedAt: new Date().toISOString(),
            elapsedMs: Date.now() - startedAt,
          };
        }
      }
    } catch {
      // Keep polling until timeout; monitor spooler may still be creating file.
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return {
    matched: false,
    elapsedMs: Date.now() - startedAt,
  };
}
