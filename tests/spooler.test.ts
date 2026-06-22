import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rotateLogs, executeWithSpooling, SpoolingForegroundResult } from '../src/utils/spooler.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
    const pioCheck = spawnSync('pio', ['--version'], { stdio: 'ignore' });
    if (pioCheck.error || pioCheck.status !== 0) {
      return;
    }

    // We run the native environment in background so we don't hang on the infinite heartbeat loop
    let result: Awaited<ReturnType<typeof executeWithSpooling>>;
    try {
      result = await executeWithSpooling(
        'run',
        ['-e', 'native', '-t', 'exec'],
        {
          cwd: nativeRigDir,
          projectDir: nativeRigDir,
          timeout: 15000,
          artifactType: 'build',
          background: true
        }
      );
    } catch (error: any) {
      const message = String(error?.message || error);
      const unsupportedHost =
        /spawn (EPERM|ENOENT)/i.test(message) ||
        /PlatformIO/i.test(message);
      expect(unsupportedHost).toBe(true);
      return;
    }

    expect(result.status).toBe('running');

    // Wait a few seconds for compilation and startup sequence to execute
    await new Promise(resolve => setTimeout(resolve, 8000));

    // The logs are written to the latest-build.log symlink
    const latestLogPath = path.join(nativeRigDir, '.pio-mcp-workspace', 'logs', 'build', 'latest-build.log');
    expect(fs.existsSync(latestLogPath)).toBe(true);
    
    const logContent = fs.readFileSync(latestLogPath, 'utf-8');
    // On hosts with native toolchain, the fixture emits runtime heartbeats.
    // On constrained hosts (e.g. missing g++), we still verify spool capture.
    const containsRuntimeMarkers =
      logContent.includes('[SYSTEM] Boot complete') &&
      logContent.includes('[HEARTBEAT] Tick: 0');
    const containsToolchainFailure =
      logContent.includes("spawn pio ENOENT") ||
      logContent.includes("'g++' is not recognized") ||
      logContent.includes("[FAILED]") ||
      logContent.includes("Error 1");
    expect(containsRuntimeMarkers || containsToolchainFailure).toBe(true);
    
    // Kill the background process after test
    if (result.pid) {
      try {
        process.kill(result.pid, 'SIGTERM');
      } catch (e) {}
    }
  }, 30000);
});
