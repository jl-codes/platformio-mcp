import { describe, it, expect, beforeEach } from 'vitest';
import { portalEvents } from '../src/api/events.js';

describe('Portal Events', () => {
  beforeEach(() => {
    portalEvents.removeAllListeners('build_log');
    portalEvents.clearTaskLog('test-project', 'task-1');
    portalEvents.clearTaskLog('test-project', 'task-2');
  });

  it('should cleanly split stream chunks based on \\n characters', () => {
    const emitted: any[] = [];
    portalEvents.on('build_log', (data) => emitted.push(data));

    // Emit partial chunk
    portalEvents.emitTaskLog('test-project', 'task-1', 'Hello');
    expect(emitted.length).toBe(0);

    // Complete chunk
    portalEvents.emitTaskLog('test-project', 'task-1', ' World\n');
    expect(emitted.length).toBe(1);
    expect(emitted[0].logLine).toBe('Hello World');
    expect(emitted[0].taskId).toBe('task-1');
    expect(emitted[0].projectId).toBe('test-project');
  });

  it('should not bleed stream output between concurrent taskIds', () => {
    const emitted: any[] = [];
    portalEvents.on('build_log', (data) => emitted.push(data));

    portalEvents.emitTaskLog('test-project', 'task-1', 'Log 1 Part A...');
    portalEvents.emitTaskLog('test-project', 'task-2', 'Log 2 Part A...');
    
    expect(emitted.length).toBe(0);

    portalEvents.emitTaskLog('test-project', 'task-1', 'Part B\n');
    portalEvents.emitTaskLog('test-project', 'task-2', 'Part C\n');

    expect(emitted.length).toBe(2);
    
    const art1Logs = emitted.filter(e => e.taskId === 'task-1');
    const art2Logs = emitted.filter(e => e.taskId === 'task-2');

    expect(art1Logs.length).toBe(1);
    expect(art1Logs[0].logLine).toBe('Log 1 Part A...Part B');

    expect(art2Logs.length).toBe(1);
    expect(art2Logs[0].logLine).toBe('Log 2 Part A...Part C');
  });
});
