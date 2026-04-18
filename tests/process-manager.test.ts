import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isBuildActive, registerBuildPid, unregisterBuildPid, killAllTrackedProcesses } from '../src/utils/process-manager.js';
import fs from 'node:fs';
import path from 'node:path';
import * as child_process from 'node:child_process';
import os from 'node:os';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof child_process>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

describe('Process Manager (Atomic Locking & Staleness)', () => {
  const testProjectDir = path.join(process.cwd(), 'test-pm-project');
  let originalKill: any;

  beforeEach(() => {
    if (!fs.existsSync(testProjectDir)) {
      fs.mkdirSync(testProjectDir, { recursive: true });
    }
    vi.clearAllMocks();
    originalKill = process.kill;
    process.kill = vi.fn().mockImplementation(() => true) as any;
  });

  afterEach(async () => {
    process.kill = originalKill;
    try {
      await killAllTrackedProcesses(testProjectDir);
    } catch {}
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  it('atomically registers and unregisters build PIDs', async () => {
    await registerBuildPid(9999, testProjectDir);
    const pidsFilePath = path.join(testProjectDir, '.pio-mcp-workspace', 'locks', 'build-pids.json');
    expect(fs.existsSync(pidsFilePath)).toBe(true);
    let pids = JSON.parse(fs.readFileSync(pidsFilePath, 'utf8'));
    expect(pids['build']).toBe(9999);

    await unregisterBuildPid(testProjectDir);
    pids = JSON.parse(fs.readFileSync(pidsFilePath, 'utf8'));
    expect(pids['build']).toBeUndefined();
  });

  it('validates active build matching platformio process command', async () => {
    await registerBuildPid(10000, testProjectDir);

    // Mock execSync to return a valid pio command
    (child_process.execSync as any).mockReturnValue('python /some/path/platformio run');

    // Make os.platform fake linux so it invokes the check
    const originalPlatform = os.platform;
    Object.defineProperty(os, 'platform', { value: () => 'linux' });

    const active = isBuildActive(testProjectDir);
    expect(active).toBe(true);
    expect(child_process.execSync).toHaveBeenCalledWith('ps -p 10000 -o command=', { encoding: 'utf8' });

    Object.defineProperty(os, 'platform', { value: originalPlatform });
  });

  it('invalidates stalled/hijacked PID returning unrelated command', async () => {
    await registerBuildPid(20000, testProjectDir);

    // Mock execSync to return an unrelated system process
    (child_process.execSync as any).mockReturnValue('discord --type=renderer');

    const originalPlatform = os.platform;
    Object.defineProperty(os, 'platform', { value: () => 'linux' });

    const active = isBuildActive(testProjectDir);
    expect(active).toBe(false);

    Object.defineProperty(os, 'platform', { value: originalPlatform });
  });
});
