import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerCommand, getCommandHistory, findCommandAcrossWorkspaces, CommandRecord } from '../src/utils/command-registry.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Cross-workspace command lookup', () => {
  const testProjectDir = path.join(os.tmpdir(), 'test-cross-ws-' + Date.now() + Math.random().toString(36).substring(7));

  beforeEach(() => {
    if (!fs.existsSync(testProjectDir)) {
      fs.mkdirSync(testProjectDir, { recursive: true });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  it('should find a task registered in a project workspace when searching without projectDir', async () => {
    const taskId = 'cross-ws-cmd-1';
    const record: CommandRecord = {
      id: taskId,
      commandDesc: 'pio run --environment esp32dev',
      timestamp: Date.now(),
      status: 'success',
      tasks: [
        {
          taskId: 'inner-task-1',
          type: 'build',
          status: 'success',
          logPaths: ['/tmp/fake-log.log'],
          exitCode: 0,
        }
      ]
    };

    // Register the command into a project-specific workspace
    await registerCommand(record, testProjectDir);

    // Verify it IS in the project registry
    const projectHistory = getCommandHistory(testProjectDir);
    expect(projectHistory.find(c => c.id === taskId)).toBeDefined();

    // Verify it is NOT in the global registry (no projectDir)
    const globalHistory = getCommandHistory();
    expect(globalHistory.find(c => c.id === taskId)).toBeUndefined();

    // Mock getWorkspaces to return our test project dir
    vi.doMock('../src/utils/workspace-registry.js', () => ({
      getWorkspaces: vi.fn().mockResolvedValue([testProjectDir]),
    }));

    // findCommandAcrossWorkspaces should locate it via workspace scan
    const result = await findCommandAcrossWorkspaces(taskId);
    expect(result).toBeDefined();
    expect(result!.command.id).toBe(taskId);
    expect(result!.command.status).toBe('success');
    expect(result!.projectDir).toBe(testProjectDir);
    expect(result!.history.length).toBeGreaterThan(0);
  });

  it('should return undefined for a task ID that does not exist anywhere', async () => {
    // Mock getWorkspaces to return our (empty) test project dir
    vi.doMock('../src/utils/workspace-registry.js', () => ({
      getWorkspaces: vi.fn().mockResolvedValue([testProjectDir]),
    }));

    const result = await findCommandAcrossWorkspaces('nonexistent-task-id');
    expect(result).toBeUndefined();
  });
});
