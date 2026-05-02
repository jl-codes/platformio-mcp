import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerCommand, updateTaskStatus, getCommandHistory, CommandRecord } from '../src/utils/command-registry.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Command Registry', () => {
  const testProjectDir = path.join(os.tmpdir(), 'test-registry-' + Date.now() + Math.random().toString(36).substring(7));

  beforeEach(() => {
    if (!fs.existsSync(testProjectDir)) {
      fs.mkdirSync(testProjectDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  it('should accurately construct the nested JSON payload matching the CommandRecord shape', async () => {
    const record: CommandRecord = {
      id: 'cmd-1',
      commandDesc: 'pio run',
      timestamp: Date.now(),
      status: 'running',
      source: 'agent',
      tasks: [
        {
          taskId: 'art-1',
          type: 'build',
          status: 'running'
        }
      ]
    };

    await registerCommand(record, testProjectDir);

    const history = getCommandHistory(testProjectDir);
    expect(history.length).toBe(1);
    expect(history[0].id).toBe('cmd-1');
    expect(history[0].source).toBe('agent');
    expect(history[0].tasks.length).toBe(1);
    expect(history[0].tasks[0].taskId).toBe('art-1');
    expect(history[0].tasks[0].type).toBe('build');
  });

  it('should recursively override deep keys inside the artifacts array via updateArtifactStatus', async () => {
    const record: CommandRecord = {
      id: 'cmd-2',
      commandDesc: 'pio test',
      timestamp: Date.now(),
      status: 'running',
      source: 'dashboard',
      tasks: [
        {
          taskId: 'art-2',
          type: 'test',
          status: 'running'
        }
      ]
    };

    await registerCommand(record, testProjectDir);
    
    // Update task status to success and add exitCode
    await updateTaskStatus('cmd-2', 'art-2', { status: 'success', exitCode: 0 }, testProjectDir);

    const history = getCommandHistory(testProjectDir);
    const cmd = history.find(c => c.id === 'cmd-2');
    expect(cmd).toBeDefined();
    
    // Validate deep keys were recursively overridden
    expect(cmd!.source).toBe('dashboard');
    expect(cmd!.tasks[0].status).toBe('success');
    expect(cmd!.tasks[0].exitCode).toBe(0);
    expect(cmd!.tasks[0].type).toBe('test'); // Retains original data

    // Since all artifacts are success, parent status should be automatically rolled up to success
    expect(cmd!.status).toBe('success');
  });
});
