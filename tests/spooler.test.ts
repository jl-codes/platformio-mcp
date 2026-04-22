import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rotateLogs, executeWithSpooling, SpoolingForegroundResult } from '../src/utils/spooler.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Spooler Log Rotation', () => {
  const testLogDir = path.join(process.cwd(), 'test-spooler-logs');

  beforeEach(() => {
    if (!fs.existsSync(testLogDir)) {
      fs.mkdirSync(testLogDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testLogDir)) {
      fs.rmSync(testLogDir, { recursive: true, force: true });
    }
  });

  it('should trim logs when exceeding maxHistory limit', async () => {
    // Generate 35 logs
    for (let i = 0; i < 35; i++) {
        const logPath = path.join(testLogDir, `build-${i}.log`);
        fs.writeFileSync(logPath, "data");
    }

    rotateLogs(testLogDir, 'build-', 30);

    const remaining = fs.readdirSync(testLogDir).filter(f => f.startsWith('build-') && f.endsWith('.log'));
    expect(remaining.length).toBe(30);
  });
});

describe('Native E2E Spooler Execution', () => {
  const nativeRigDir = path.join(process.cwd(), 'tests', '__fixtures__', 'native-rig');

  afterEach(() => {
    const logDir = path.join(nativeRigDir, '.pio-mcp-workspace', 'logs');
    if (fs.existsSync(logDir)) {
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  });

  it('should compile and capture native execution stdout via spooling', async () => {
    // We run the native environment in background so we don't hang on the infinite heartbeat loop
    const result = await executeWithSpooling(
      'pio',
      ['run', '-e', 'native', '-t', 'exec'],
      {
        cwd: nativeRigDir,
        projectDir: nativeRigDir,
        timeout: 15000,
        artifactType: 'build',
        background: true
      }
    );

    expect(result.status).toBe('running');

    // Wait a few seconds for compilation and startup sequence to execute
    await new Promise(resolve => setTimeout(resolve, 8000));

    // The logs are written to the latest-build.log symlink
    const latestLogPath = path.join(nativeRigDir, '.pio-mcp-workspace', 'logs', 'build', 'latest-build.log');
    expect(fs.existsSync(latestLogPath)).toBe(true);
    
    const logContent = fs.readFileSync(latestLogPath, 'utf-8');
    expect(logContent).toContain('[SYSTEM] Boot complete');
    expect(logContent).toContain('[HEARTBEAT] Tick: 0');
    
    // Kill the background process after test
    if (result.pid) {
      try {
        process.kill(result.pid, 'SIGTERM');
      } catch (e) {}
    }
  }, 30000);
});
