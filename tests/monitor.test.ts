import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startMonitor, stopMonitor, queryLogs } from '../src/tools/monitor.js';
import { registerPioMonitorPid, killPioMonitorByPort, unregisterPioMonitorPid } from '../src/utils/process-manager.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Monitor API', () => {
  const testProjectDir = path.join(process.cwd(), 'test-project');

  beforeEach(() => {
    // Setup test environment if needed
    if (!fs.existsSync(testProjectDir)) {
      fs.mkdirSync(testProjectDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Teardown
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  it('registers and unregisters PIO monitor PID correctly in workspace', async () => {
    registerPioMonitorPid('COM1', 12345, testProjectDir);
    const pidsFilePath = path.join(testProjectDir, '.pio-mcp-workspace', 'locks', 'serial-pids.json');
    
    expect(fs.existsSync(pidsFilePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(pidsFilePath, 'utf8'));
    expect(content['COM1']).toBe(12345);

    unregisterPioMonitorPid('COM1', testProjectDir);
    const updatedContent = JSON.parse(fs.readFileSync(pidsFilePath, 'utf8'));
    expect(updatedContent['COM1']).toBeUndefined();
  });

  it('fails gracefully when queryLogs called on missing port log', async () => {
    const result = await queryLogs(10, undefined, testProjectDir, 'COM99');
    expect(result.success).toBe(false);
    expect(result.content).toMatch(/No active or recent logs found/);
  });
});
